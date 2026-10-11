import * as THREE from 'three'
import gsap from 'gsap'
import { GuideCharacter } from './GuideCharacter.js'
import { buildVillager } from './procedural/villager.js'

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000))
/** Walking pace to the line (m/s), the seconds a walk spends speeding up and slowing down,
 *  and the time it takes to appear at the door. */
const WALK_SPEED = 4.6
const RAMP = 0.9
const APPEAR = 0.95
/** Seconds between one neighbour reaching the line and the next. */
const ARRIVAL_GAP = 1.1
/** Time to turn round on the spot before the first step. */
const TURN = 0.25
/** How much room a person standing still takes, for those walking past (m). */
const PERSON = 0.6
/** Waiting in line, people only look about; no hops, steps or fidgeting. */
const CALM = ['glance', 'lookAround']
const standing = (p) => ({ x: p.x, z: p.z, r: PERSON })

/**
 * A street route with the points that fall inside the line left out: a street corner can sit
 * right where people stand waiting (spots 0 to `last`), and nobody walks through them to
 * reach it. The route's end is always kept, and its start too when `keepStart`.
 */
function outsideLine(hood, points, last, keepStart) {
    if (last < 0) return points
    const a = hood.queueSpot(0), b = hood.queueSpot(last)
    const abx = b.x - a.x, abz = b.z - a.z
    const ab2 = abx * abx + abz * abz || 1
    const far = (p) => {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / ab2))
        return Math.hypot(p.x - a.x - abx * t, p.z - a.z - abz * t) > 1.1
    }
    return points.filter((p, i) => (i === 0 && keepStart) || i === points.length - 1 || far(p))
}
const pathLength = (pts) => pts.reduce((n, p, i) => (i ? n + p.distanceTo(pts[i - 1]) : 0), 0)

/**
 * The families of the barrio, after a donation.
 *
 * One neighbour leaves each house that was helped and walks to the collection
 * point, where they wait their turn in a single line, one behind the other.
 * At the counter each takes exactly their share off the table (the stand's
 * display goes down as they do), and carries it home. This is the only moment
 * in the experience where the aid is shown arriving, so it is kept calm and
 * orderly: no crowd, no celebration, just people collecting what they needed.
 *
 * They reuse GuideCharacter for walking and animation, so they move with the
 * same weight as the guide and follow the barrio's terrain the same way.
 */
export class Families {
    /** @param makePerson (n) → a model for the n-th neighbour; the drawn villager if not given */
    constructor({ parent, reducedMotion = false, makePerson = null } = {}) {
        this.parent = parent
        this.makePerson = makePerson
        this.reducedMotion = reducedMotion
        this.group = new THREE.Group()
        this.group.name = 'families'
        parent.add(this.group)
        this.active = new Set()
        this.seed = 0
        this.running = null
        /** People waiting at the counter, in order; [0] is being served next. */
        this.line = []
        this.waiters = new Set()
    }

    get busy() {
        return !!this.running
    }

    /**
     * @param hood  the neighborhood scene, used for street routing and the stand's display
     * @param jobs  [{ houseId, items }] one entry per house that was helped, with what it takes
     * @param avoid [{x, z, r}] anyone else standing about (the guide), for the walkers to go round
     */
    run(hood, jobs, { avoid = [] } = {}) {
        if (!jobs.length) return Promise.resolve()
        // The order is decided before anyone leaves home: the family with the shortest walk
        // stands first. Each takes the most direct way the streets allow and sets off so as
        // to reach the line a beat after the one ahead of it, stepping in right behind them:
        // nobody waits for nothing, overtakes, or walks through anyone else.
        const plan = jobs
            .map((job) => {
                if (!hood.house(job.houseId)?.door || !hood.acopio) return null
                const route = hood.route(`door:${job.houseId}`, 'acopio')
                return { job, route, length: pathLength(hood.smoothPath(route.points, { avoid })) }
            })
            .filter(Boolean)
            .sort((a, b) => a.length - b.length)
        const front = new THREE.Vector3(Math.sin(hood.acopio.yaw), 0, Math.cos(hood.acopio.yaw))
        const across = new THREE.Vector3(front.z, 0, -front.x)
        plan.forEach((p, i) => {
            // the street, then in behind the last person already there (coming up beside the
            // line, never through it), and one step up to the place
            const ahead = Array.from({ length: i }, (_, k) => standing(hood.queueSpot(k)))
            const street = outsideLine(hood, p.route.points.slice(0, -1), i - 1, true)
            const behind = hood.queueSpot(i + 0.9)
            const from = street[street.length - 1].clone().sub(behind)
            const way = [...street]
            if (i > 0 && Math.abs(from.dot(across)) > 0.3 && from.dot(front) < 0.5) way.push(behind.clone().addScaledVector(across, Math.sign(from.dot(across)) * 1.4))
            way.push(behind)
            p.path = [...hood.smoothPath(way, { avoid: [...avoid, ...ahead] }), hood.queueSpot(i)]
            p.length = pathLength(p.path)
        })
        const travel = plan.map((p) => (APPEAR + TURN + p.length / WALK_SPEED + RAMP) * (this.reducedMotion ? 0.6 : 1))
        const t0 = Math.max(0, ...travel.map((t, i) => t - i * ARRIVAL_GAP))
        // one place per family, in order; a place leaves the line when its family is served
        this.line = plan.map(() => ({ person: null }))
        const all = plan.map((p, i) => this.#oneFamily(hood, p, this.line[i], Math.max(0, t0 + i * ARRIVAL_GAP - travel[i]), avoid))
        this.running = Promise.all(all).finally(() => (this.running = null))
        return this.running
    }

    /** Resolves the next time the line moves (someone was served, or everyone went home). */
    #lineMoved() {
        return new Promise((resolve) => this.waiters.add(resolve))
    }

    #notify() {
        const ws = [...this.waiters]
        this.waiters.clear()
        ws.forEach((r) => r())
    }

    async #oneFamily(hood, { job, path }, place, delay, avoid) {
        const { houseId, items } = job
        const house = hood.house(houseId)
        const acopio = hood.acopio
        if (!house?.door || !acopio) return

        await wait(delay)
        if (!this.alive) return

        // everyone is drawn at the guide's size, so the scale of the barrio reads the same
        const n = this.seed++
        const model = this.makePerson?.(n) ?? buildVillager({ palette: n })
        // built on the guide's model, they share its face too (eyes that blink and look around)
        const person = new GuideCharacter(model, [], { reducedMotion: this.reducedMotion, face: !!this.makePerson, idle: CALM })
        const parcel = person.model.getObjectByName('parcel')
        this.group.add(person.root)
        this.active.add(person)

        // step out of the doorway already facing the way they are going
        const start = house.door.clone()
        const first = path.find((q) => Math.hypot(q.x - start.x, q.z - start.z) > 0.3) ?? acopio.door
        person.place(start, Math.atan2(first.x - start.x, first.z - start.z))
        await person.appear()
        if (!this.active.has(person)) return

        // their place in the line was fixed before they left
        place.person = person
        await person.walk([start, ...path.slice(1)], { speed: WALK_SPEED })

        // step forward each time the person in front is served, until it is our turn
        while (this.active.has(person)) {
            const spot = hood.queueSpot(this.line.indexOf(place))
            const there = Math.hypot(person.position.x - spot.x, person.position.z - spot.z) < 0.05
            if (!there) {
                await person.walk([person.position.clone(), spot], { speed: 2.6 })
                // land exactly on the spot, not just near it
                person.position.x = spot.x
                person.position.z = spot.z
                continue
            }
            person.faceTowards(acopio.center)
            // tell the others only when this changes, or two waiting neighbours would wake each other forever
            if (!place.ready) {
                place.ready = true
                this.#notify()
            }
            // serving starts once the whole line stands in place, and goes strictly in order
            if (this.line[0] === place && this.line.every((p) => p.ready)) break
            await this.#lineMoved()
        }
        if (!this.active.has(person)) return

        // at the counter: take exactly this family's share off the table
        await wait(0.6)
        if (!this.active.has(person)) return
        person.nod()
        hood.takeFromDisplay(items)
        if (parcel) {
            parcel.visible = true
            parcel.scale.setScalar(0.01)
            gsap.to(parcel.scale, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(2)' })
        }
        await wait(0.7)
        if (!this.active.has(person)) return

        // step off the counter to the side home lies on, clear of the line; only then does the
        // line move up, all together, one place each
        const front = new THREE.Vector3(Math.sin(acopio.yaw), 0, Math.cos(acopio.yaw))
        // the streets home, leaving out any corner where the line stands
        const home = outsideLine(hood, hood.route('acopio', houseId).points.slice(1), this.line.length - 1, false)
        const next = home[0]
        const side = new THREE.Vector3(front.z, 0, -front.x)
        if (side.dot(next.clone().sub(person.position)) < 0) side.negate()
        const aside = person.position.clone().addScaledVector(side, 1.6)
        await person.walk([person.position.clone(), aside], { speed: 2.6 })
        this.line.splice(this.line.indexOf(place), 1)
        for (const p of this.line) p.ready = false
        this.#notify()
        if (!this.active.has(person)) return

        // home the most direct way; if it lies across the line, round its far end, never through it
        const left = this.line.length
        const people = [
            ...this.line.flatMap((p) => (p.person ? [standing(p.person.position)] : [])),
            ...this.line.map((_, k) => standing(hood.queueSpot(k))),
        ]
        const round = hood.queueSpot(left + 0.7)
        const way = left ? [aside, round.clone().addScaledVector(side, 1.6), round, ...home] : [aside, ...home]
        await person.walk(hood.smoothPath(way, { avoid: [...avoid, ...people] }), { speed: 4.8 })
        if (!this.active.has(person)) return

        // home again
        person.faceTowards(house.center)
        await wait(0.25)
        await this.#fadeOut(person)
        this.#dispose(person)
    }

    #fadeOut(person) {
        const s = { o: 1 }
        return new Promise((resolve) =>
            gsap.to(s, {
                o: 0,
                duration: this.reducedMotion ? 0.15 : 0.6,
                ease: 'sine.in',
                onUpdate: () => {
                    person.model.traverse((o) => {
                        if (!o.isMesh) return
                        const mats = Array.isArray(o.material) ? o.material : [o.material]
                        for (const m of mats) {
                            m.transparent = true
                            m.opacity = s.o
                        }
                    })
                    person.blob.material.opacity = s.o
                },
                onComplete: resolve,
            })
        )
    }

    #dispose(person) {
        this.active.delete(person)
        person.stop()
        this.group.remove(person.root)
        person.model.traverse((o) => {
            if (!o.isMesh) return
            o.geometry.dispose()
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            for (const m of mats) m.dispose()
        })
        person.blob.geometry.dispose()
        person.blob.material.dispose()
    }

    /** Everyone goes home at once — used when leaving the barrio. */
    clear() {
        for (const person of [...this.active]) this.#dispose(person)
        this.active.clear()
        this.line = []
        this.#notify()
        this.running = null
    }

    get alive() {
        return !!this.group.parent
    }

    update(dt, t, heightAt) {
        for (const person of this.active) {
            person.update(dt, t)
            const p = person.position
            p.y = heightAt(p.x, p.z)
        }
    }
}
