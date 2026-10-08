import * as THREE from 'three'
import gsap from 'gsap'
import { GuideCharacter } from './GuideCharacter.js'
import { buildVillager } from './procedural/villager.js'

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000))

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
    constructor({ parent, reducedMotion = false } = {}) {
        this.parent = parent
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
     */
    run(hood, jobs) {
        if (!jobs.length) return Promise.resolve()
        const all = jobs.map((job, i) => this.#oneFamily(hood, job, i))
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

    async #oneFamily(hood, { houseId, items }, index) {
        const house = hood.house(houseId)
        const acopio = hood.acopio
        if (!house?.door || !acopio) return

        await wait(index * (this.reducedMotion ? 0.15 : 0.4))
        if (!this.alive) return

        // everyone is drawn at the guide's size, so the scale of the barrio reads the same
        const model = buildVillager({ palette: this.seed++ })
        const person = new GuideCharacter(model, [], { reducedMotion: this.reducedMotion })
        const parcel = person.model.getObjectByName('parcel')
        this.group.add(person.root)
        this.active.add(person)

        // step out of the doorway, facing the street
        const start = house.door.clone()
        person.place(start, Math.atan2(acopio.door.x - start.x, acopio.door.z - start.z))
        await person.appear()
        if (!this.active.has(person)) return

        // join the back of the line and walk there along the street
        this.line.push(person)
        const out = hood.route(`door:${houseId}`, 'acopio')
        const toLine = out.points.slice(0, -1)
        toLine.push(hood.queueSpot(this.line.indexOf(person)))
        await person.walk(toLine, { speed: 5.2 })

        // step forward each time the person in front is served, until it is our turn
        while (this.active.has(person)) {
            const spot = hood.queueSpot(this.line.indexOf(person))
            const there = Math.hypot(person.position.x - spot.x, person.position.z - spot.z) < 0.15
            if (!there) {
                await person.walk([person.position.clone(), spot], { speed: 3 })
                continue
            }
            person.faceTowards(acopio.center)
            if (this.line[0] === person) break
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
        // leave the counter: the next in line moves up
        this.line.splice(this.line.indexOf(person), 1)
        this.#notify()
        if (!this.active.has(person)) return

        const back = hood.route('acopio', houseId)
        back.points[0] = person.position.clone()
        await person.walk(back.points, { speed: 4.8 })
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
