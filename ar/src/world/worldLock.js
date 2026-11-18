import * as THREE from 'three'

const up = new THREE.Vector3(0, 1, 0)

/** A matrix of position and turn about the vertical only: what a table's frame is. */
export function yawMatrix(position, yaw, out = new THREE.Matrix4()) {
    return out.makeRotationY(yaw).setPosition(position)
}

/** The same matrix with any tilt taken out (an anchor's pose wobbles a little). */
function levelled(m, out = new THREE.Matrix4()) {
    const p = new THREE.Vector3().setFromMatrixPosition(m)
    const x = new THREE.Vector3(1, 0, 0).transformDirection(m)
    return yawMatrix(p, Math.atan2(-x.z, x.x), out)
}

/**
 * Keeps the shift where it is in the real room, whatever the headset does with its own origin.
 *
 * Everything of the shift lives in the scene's coordinates, fixed once the table was chosen. The
 * headset reports poses (head, hands, planes) in its reference space, whose origin it may move: a
 * recentring (the system gesture, a palm turned up and a pinch held, done easily while carrying
 * something), tracking found again, or a new session. If nothing made up for it, every carton,
 * shelf and person would jump together with that move, as if the whole scene had been grabbed.
 *
 * The player (the SDK's origin, parent of the camera and of the hands' poses) holds the matrix from
 * the headset's space to the scene's. It is kept right by an anchor laid at the table's frame: the
 * headset keeps an anchor fixed in the real room, so each frame the anchor's pose says exactly where
 * the scene must be. Without anchors, the `reset` event of the reference space is used, which only
 * works when the browser says by how much the origin moved.
 */
export class WorldLock {
    constructor(world) {
        this.world = world
        this.mode = 'sin anclaje'
        this.anchor = null
        this.sceneOfAnchor = null
        this.resets = 0
        this.resetsWithoutTransform = 0
        this.corrections = 0
        this.lastJump = 0
        this.anchorLost = false
        this.watched = null
    }

    /** From the headset's space into the scene. */
    get toScene() {
        this.world.player.updateMatrixWorld(true)
        return this.world.player.matrixWorld
    }

    #setPlayer(m) {
        const player = this.world.player
        m.decompose(player.position, player.quaternion, player.scale)
        player.updateMatrixWorld(true)
    }

    /** A new session: its space starts where the scene does, until the table is found again. */
    begin() {
        this.anchor = null
        this.sceneOfAnchor = null
        this.anchorLost = false
        this.mode = 'sin anclaje'
        this.#setPlayer(new THREE.Matrix4())
    }

    /** Listens to the reference space for its origin moving (once per space). */
    watch(space) {
        if (!space || space === this.watched) return
        this.watched = space
        space.addEventListener?.('reset', (event) => this.#onReset(event))
    }

    #onReset(event) {
        this.resets++
        const t = event.transform
        if (!t) this.resetsWithoutTransform++
        // with an anchor, the next frame puts everything right by itself
        if (this.anchor || !t) return
        // the new origin, given in the old space: the scene stays in the old one
        const player = this.world.player
        player.updateMatrix()
        const m = player.matrix.clone().multiply(new THREE.Matrix4().fromArray(t.matrix))
        this.#setPlayer(m)
        this.corrections++
    }

    /**
     * The table was found again in a new session (`frameInSpace`, in the headset's space): the scene's
     * table (`frameInScene`) is made to coincide with it, without moving anything of the shift.
     */
    align(frameInScene, frameInSpace) {
        const m = frameInScene.clone().multiply(frameInSpace.clone().invert())
        this.#setPlayer(levelled(m))
    }

    /** Lays an anchor at this pose of the scene, if the headset has anchors. */
    async lockAt(xrFrame, space, sceneMatrix) {
        if (!xrFrame?.createAnchor || !space || typeof XRRigidTransform === 'undefined') {
            this.mode = 'evento reset (sin anclas)'
            return false
        }
        try {
            const inSpace = new THREE.Matrix4().copy(this.toScene).invert().multiply(sceneMatrix)
            const p = new THREE.Vector3()
            const q = new THREE.Quaternion()
            inSpace.decompose(p, q, new THREE.Vector3())
            const anchor = await xrFrame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), space)
            this.anchor = anchor
            this.sceneOfAnchor = levelled(sceneMatrix)
            this.mode = 'ancla'
            return true
        } catch (err) {
            console.warn('[ar1] no anchor; the reset event keeps the scene in place', err)
            this.mode = `evento reset (ancla rechazada: ${err?.name ?? err})`
            return false
        }
    }

    /** Each frame: where the anchor is now says where the scene goes. */
    update(xrFrame, space) {
        if (!this.anchor || !xrFrame || !space) return
        let pose = null
        try {
            pose = xrFrame.getPose(this.anchor.anchorSpace, space)
        } catch {
            pose = null
        }
        this.anchorLost = !pose
        if (!pose) return
        const inSpace = levelled(new THREE.Matrix4().fromArray(pose.transform.matrix))
        const want = this.sceneOfAnchor.clone().multiply(inSpace.invert())
        const player = this.world.player
        const p = new THREE.Vector3().setFromMatrixPosition(want)
        const jump = p.distanceTo(player.position)
        const x = new THREE.Vector3(1, 0, 0).transformDirection(want)
        const yaw = Math.atan2(-x.z, x.x)
        const now = new THREE.Euler().setFromQuaternion(player.quaternion, 'YXZ').y
        const turn = Math.abs(Math.atan2(Math.sin(yaw - now), Math.cos(yaw - now)))
        // the anchor's pose trembles by fractions of a millimetre: only real moves are followed
        if (jump < 0.002 && turn < 0.002) return
        if (jump > 0.05 || turn > 0.05) {
            this.corrections++
            this.lastJump = jump
        }
        player.position.copy(p)
        player.quaternion.setFromAxisAngle(up, yaw)
        player.updateMatrixWorld(true)
    }

    end() {
        try {
            this.anchor?.delete?.()
        } catch {
            // the session that owned it is gone already
        }
        this.anchor = null
        this.mode = 'sin sesión'
    }

    report() {
        return { modo: this.mode, resets: this.resets, resetsSinTransform: this.resetsWithoutTransform, correcciones: this.corrections, anclaPerdida: this.anchorLost }
    }
}
