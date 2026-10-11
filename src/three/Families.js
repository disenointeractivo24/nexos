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
/** Units of supplies per person who comes to collect them, and the most the line holds. */
const PER_PERSON = 2
const MAX_GROUPS = 10
/**
 * Who comes to collect: an adult alone, a mother or father with their child, an older
 * person (slower, a little stooped), a grandparent with a grandchild, a teenager.
 * `pace` scales the walk; the line takes them in turn from MIX, so every age shows up.
 */
const KINDS = {
    adult: { age: 'adult', pace: 1 },
    parent: { age: 'adult', pace: 0.85, child: true },
    elder: { age: 'elder', pace: 0.7, stoop: 0.17 },
    grandparent: { age: 'elder', pace: 0.66, stoop: 0.17, child: true },
    teen: { age: 'teen', pace: 1.05, scale: 0.87 },
}
const MIX = ['parent', 'elder', 'adult', 'teen', 'grandparent', 'parent', 'adult', 'elder', 'parent', 'teen']
/** A child is drawn this much smaller than an adult, and keeps this place beside them
 *  (x across, z ahead, in the adult's frame). */
const CHILD_SCALE = 0.62
const CHILD_BESIDE = { x: 0.62, z: -0.12 }
const CHILD_WALKING = { x: 0.46, z: -0.25 }
/** Room a standing child takes, for those walking past (m). */
const CHILD_ROOM = 0.6
/** Seconds before a second person can come out of the same door: the first has to clear it. */
const DOOR_CLEAR = APPEAR + TURN + 1.3

const pathLength = (pts) => pts.reduce((n, p, i) => (i ? n + p.distanceTo(pts[i - 1]) : 0), 0)
const standing = (p, r = PERSON) => ({ x: p.x, z: p.z, r })
/** Where a child stands beside an adult at `pos` facing `yaw`. */
const beside = (pos, yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    return new THREE.Vector3(pos.x + c * CHILD_BESIDE.x + s * CHILD_BESIDE.z, pos.y, pos.z - s * CHILD_BESIDE.x + c * CHILD_BESIDE.z)
}

/**
 * How a donation is collected: by as many people as it takes (one for every PER_PERSON
 * units, up to MAX_GROUPS, and at least one per house served when the line has room),
 * each carrying exactly the same amount. Where it can, the count is one that divides the
 * total evenly; otherwise shares differ by one unit at most.
 *
 * @param served [{houseId, items: Map}] what each house was given (applyDonation)
 * @returns [{houseId, items: Map}] one entry per person who comes
 */
export function shareOut(served) {
    const units = []
    for (const { items } of served) for (const [id, q] of items) for (let i = 0; i < q; i++) units.push(id)
    const total = units.length
    if (!total || !served.length) return []
    const want = Math.max(1, Math.min(MAX_GROUPS, total, Math.max(Math.round(total / PER_PERSON), served.length)))
    let count = want
    search: for (let d = 0; d <= 3; d++) {
        for (const n of [want + d, want - d]) {
            if (n >= 1 && n <= MAX_GROUPS && n <= total && total % n === 0) {
                count = n
                break search
            }
        }
    }
    // dealt round like cards, kind by kind, so every share is the same size
    const shares = Array.from({ length: count }, () => new Map())
    units.sort().forEach((id, i) => {
        const m = shares[i % count]
        m.set(id, (m.get(id) ?? 0) + 1)
    })
    return shares.map((items, k) => ({ houseId: served[k % served.length].houseId, items }))
}

/**
 * The families of the barrio, after a donation.
 *
 * People leave the houses that were helped and walk to the collection point, where
 * they wait their turn in a single line, one behind the other. Some come alone, some
 * with a child at their side; there are young and old among them. At the counter each
 * takes exactly their share off the table (the stand's display goes down as they do),
 * and carries it home. This is the only moment in the experience where the aid is
 * shown arriving, so it is kept calm and orderly: no crowd, no celebration, just
 * people collecting what they needed.
 *
 * They reuse GuideCharacter for walking and animation, so they move with the same
 * weight as the guide and follow the barrio's terrain the same way.
 */
export class Families {
    /** @param makePerson (n, age) → a model for the n-th neighbour; the drawn villager if not given */
    constructor({ parent, reducedMotion = false, makePerson = null } = {}) {
        this.parent = parent
        this.makePerson = makePerson
        this.reducedMotion = reducedMotion
        this.group = new THREE.Group()
        this.group.name = 'families'
        parent.add(this.group)
        this.active = new Set()
        this.seed = 0
        this.mixAt = 0
        this.running = null
        /** Places in the line, in order; [0] is served next. Each is {person, child, ready}. */
        this.line = []
        this.waiters = new Set()
    }

    get busy() {
        return !!this.running
    }

    /**
     * @param hood   the neighborhood scene, used for paths and the stand's display
     * @param served [{ houseId, items }] what each house was given, with what it takes
     * @param avoid  [{x, z, r}] anyone else standing about (the guide), for the walkers to go round
     */
    run(hood, served, { avoid = [] } = {}) {
        const shares = shareOut(served)
        if (!shares.length || !hood.acopio) return Promise.resolve()

        // The order is decided before anyone leaves home: whoever is nearest (at their own
        // pace) stands first. Each takes the most direct way and sets off so as to reach the
        // line a beat after the one ahead of them, stepping in right behind them: nobody
        // waits for nothing, overtakes, or walks through anyone else.
        const plan = shares
            .map((share, k) => {
                const house = hood.house(share.houseId)
                if (!house?.door) return null
                const kind = KINDS[MIX[(this.mixAt + k) % MIX.length]]
                const way = this.#way(hood, house.door, hood.queueSpot(0), avoid, share.houseId)
                return { share, house, kind, time: pathLength(way) / kind.pace }
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time)
        this.mixAt += shares.length
        plan.forEach((p, i) => {
            // the people already in line ahead, and the children beside them
            const ahead = plan.slice(0, i).flatMap((q, k) => {
                const spot = hood.queueSpot(k)
                return q.kind.child ? [standing(spot), standing(beside(spot, hood.queueYaw(k)), CHILD_ROOM)] : [standing(spot)]
            })
            // in behind the last person already there, then one step up to the place
            const behind = hood.queueSpot(i + 1.15)
            p.path = [...this.#way(hood, p.house.door, behind, [...avoid, ...ahead], p.share.houseId), hood.queueSpot(i)]
        })
        // arrivals a beat apart, in order; two people from one house leave it one after the other
        const pace = this.reducedMotion ? 0.6 : 1
        const travel = plan.map((p) => (APPEAR + TURN + pathLength(p.path) / (WALK_SPEED * p.kind.pace) + RAMP) * pace)
        const left = new Map()
        let arrival = -Infinity
        const starts = plan.map((p, i) => {
            const earliest = Math.max(0, (left.get(p.share.houseId) ?? -Infinity) + DOOR_CLEAR * pace)
            // behind someone with a child, a moment more: the child settles in beside them first
            arrival = Math.max(arrival + ARRIVAL_GAP + (i && plan[i - 1].kind.child ? 0.5 : 0), earliest + travel[i])
            left.set(p.share.houseId, arrival - travel[i])
            return arrival - travel[i]
        })
        this.line = plan.map(() => ({ person: null, child: null }))
        const all = plan.map((p, i) => this.#oneFamily(hood, p, this.line[i], starts[i], avoid))
        this.running = Promise.all(all).finally(() => (this.running = null))
        return this.running
    }

    /** A path between two places; the streets, made direct, if the search finds none. */
    #way(hood, from, to, avoid, houseId) {
        const found = hood.findPath(from, to, { avoid })
        if (found) return found
        const street = hood.route(`door:${houseId}`, 'acopio').points
        return hood.smoothPath([from, ...street.slice(1, -1), to], { avoid })
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

    /** A neighbour of the given age, drawn at the guide's size (children and teens smaller). */
    #person(age, { stoop = 0, scale = 1 } = {}) {
        const n = this.seed++
        const model = this.makePerson?.(n, age) ?? buildVillager({ palette: n })
        // built on the guide's model, they share its face too (eyes that blink and look around)
        const person = new GuideCharacter(model, [], { reducedMotion: this.reducedMotion, face: !!this.makePerson, idle: CALM, stoop })
        person.root.scale.setScalar(scale)
        person.order = n
        this.group.add(person.root)
        this.active.add(person)
        return person
    }

    async #oneFamily(hood, { share, house, kind, path }, place, delay, avoid) {
        const acopio = hood.acopio
        await wait(delay)
        if (!this.alive) return

        const person = this.#person(kind.age, { stoop: kind.stoop, scale: kind.scale })
        const child = kind.child ? this.#person('child', { scale: CHILD_SCALE }) : null
        const group = child ? [person, child] : [person]
        const parcel = person.model.getObjectByName('parcel')

        // step out of the doorway already facing the way they are going; a child at their side
        const start = house.door.clone()
        const first = path.find((q) => Math.hypot(q.x - start.x, q.z - start.z) > 0.3) ?? acopio.door
        const yaw = Math.atan2(first.x - start.x, first.z - start.z)
        person.place(start, yaw)
        if (child) {
            child.follow(person, CHILD_BESIDE, CHILD_WALKING)
            child.place(beside(start, yaw), yaw)
        }
        await Promise.all(group.map((g) => g.appear()))
        if (!this.active.has(person)) return

        // their place in the line was fixed before they left
        place.person = person
        place.child = child
        await person.walk([start, ...path.slice(1)], { speed: WALK_SPEED * kind.pace })

        // step forward each time the person in front is served, until it is our turn
        while (this.active.has(person)) {
            const spot = hood.queueSpot(this.line.indexOf(place))
            const there = Math.hypot(person.position.x - spot.x, person.position.z - spot.z) < 0.05
            if (!there) {
                await person.walk([person.position.clone(), spot], { speed: 2.6 * kind.pace })
                // land exactly on the spot, not just near it
                person.position.x = spot.x
                person.position.z = spot.z
                continue
            }
            // facing the one ahead (the counter, at the front of the line)
            const yaw = hood.queueYaw(this.line.indexOf(place))
            person.faceTowards(person.position.clone().add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))))
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

        // at the counter: take exactly this share off the table
        await wait(0.6)
        if (!this.active.has(person)) return
        person.nod()
        hood.takeFromDisplay(share.items)
        if (parcel) {
            parcel.visible = true
            parcel.scale.setScalar(0.01)
            gsap.to(parcel.scale, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(2)' })
        }
        await wait(0.7)
        if (!this.active.has(person)) return

        // step off the counter on the line's open side (the children in it stand on the other),
        // clear of everyone; only then does the line move up, all together, one place each
        const front = hood.queueSpot(1).sub(hood.queueSpot(0)).setY(0).normalize()
        const yaw0 = hood.queueYaw(0)
        const side = new THREE.Vector3(-Math.cos(yaw0), 0, Math.sin(yaw0))
        // a step back from the counter as well as aside, so nobody brushes the stand on the way out
        const aside = person.position.clone().addScaledVector(side, child ? 2 : 1.6).addScaledVector(front, 0.7)
        await person.walk([person.position.clone(), aside], { speed: 2.6 * kind.pace })
        this.line.splice(this.line.indexOf(place), 1)
        for (const p of this.line) p.ready = false
        this.#notify()
        if (!this.active.has(person)) return

        // home the most direct way, round the line, never through it: everyone in it counts,
        // where they stand now and where they are stepping up to
        const people = this.line.flatMap((p, k) => {
            const spot = hood.queueSpot(k)
            const all = [standing(spot)]
            if (p.person) all.push(standing(p.person.position))
            if (p.child) all.push(standing(p.child.position, CHILD_ROOM), standing(beside(spot, hood.queueYaw(k)), CHILD_ROOM))
            return all
        })
        const home = this.#way(hood, aside, house.door, [...avoid, ...people], share.houseId)
        await person.walk(home, { speed: 4.8 * kind.pace })
        if (!this.active.has(person)) return

        // home again
        person.faceTowards(house.center)
        await wait(0.25)
        await Promise.all(group.map((g) => this.#fadeOut(g)))
        group.forEach((g) => this.#dispose(g))
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
        // nobody walks into anyone: whoever has someone close ahead of them (standing, slower, or
        // joining the same street) eases off and lets them go first; when two would meet, the
        // one who set out later gives way (a child and their own adult excepted)
        const all = [...this.active]
        const inFront = (a, b) => {
            const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z
            const d = Math.hypot(dx, dz)
            return d < 1.3 && d > 1e-3 && (dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw)) / d > 0.4 ? d : 0
        }
        for (const a of all) {
            a.hold = 1
            a.sideWant = 0
            if (!a.path) continue
            const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw)
            for (const b of all) {
                if (b === a || b.leader === a || a.leader === b) continue
                // passing someone (beside or a little ahead): keep out to the side, away from them
                const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z
                const along = dx * fx + dz * fz
                const across = dx * fz - dz * fx
                if (along > -0.4 && along < 1.6 && Math.abs(across) < 1) a.sideWant -= Math.sign(across || 1) * (1 - Math.abs(across)) * 0.8
            }
            a.sideWant = THREE.MathUtils.clamp(a.sideWant, -0.6, 0.6)
            for (const b of all) {
                if (b === a || b.leader === a || a.leader === b) continue
                const d = inFront(a, b)
                if (!d) continue
                // someone coming straight the other way is passed, not waited for
                if (b.path && Math.sin(b.yaw) * Math.sin(a.yaw) + Math.cos(b.yaw) * Math.cos(a.yaw) < -0.6) continue
                if (b.path && inFront(b, a) && a.order < b.order) continue
                a.hold = Math.min(a.hold, THREE.MathUtils.clamp((d - 0.6) / 0.55, 0, 1))
            }
        }
        // children after their parents (the order they were added), so they follow this frame's step
        for (const person of this.active) {
            person.update(dt, t)
            const p = person.position
            p.y = heightAt(p.x, p.z)
        }
    }
}
