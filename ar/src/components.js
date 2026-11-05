import { createComponent, defineComponents } from '@iwsdk/core'

/** Something the person can press or pick: its behaviour lives in ShiftSystem, by entity. */
export const Workable = createComponent('Workable', {})

export default defineComponents([Workable])
