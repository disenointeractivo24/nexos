import { buildGuide } from './guide.js'
import { buildRice, buildWater, buildCans, buildMilk, buildMedicine, buildSoap, buildBlanket, buildHygieneKit } from './supplies.js'

/** Builder ids referenced by `procedural` in data/assets.js */
export const PROCEDURAL = {
    guide: buildGuide,
    rice: buildRice,
    water: buildWater,
    cans: buildCans,
    milk: buildMilk,
    medicine: buildMedicine,
    soap: buildSoap,
    blanket: buildBlanket,
    hygieneKit: buildHygieneKit,
}
