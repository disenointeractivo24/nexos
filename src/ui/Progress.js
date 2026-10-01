import { icon } from './icons.js'

/** Steps for each role. Short words; the line answers "where am I?" */
export const STEPS = {
    donor: ['Ciudad', 'Barrio', 'Punto', 'Cesta', 'Método', 'Confirmación'],
    collector: ['Acceso', 'Ciudad', 'Barrio', 'Revisión'],
}

/**
 * A quiet line of dots under the top bar. Completed steps show a check,
 * the current one is filled red with its label in bold.
 */
export class Progress {
    constructor(el) {
        this.el = el
        this.steps = []
        this.index = -1
    }

    setSteps(steps) {
        if (this.steps === steps) return
        this.steps = steps
        this.index = -1
        this.el.innerHTML = `
            <ol class="progress-list">
                ${steps
                    .map(
                        (s, i) => `
                    <li class="progress-step" data-i="${i}">
                        <span class="progress-dot" aria-hidden="true">${icon('check')}</span>
                        <span class="progress-label">${s}</span>
                    </li>`
                    )
                    .join('')}
            </ol>
            <p class="progress-compact" aria-hidden="true"></p>`
    }

    set(index) {
        if (index === this.index) return
        this.index = index
        this.el.querySelectorAll('.progress-step').forEach((li, i) => {
            li.classList.toggle('is-done', i < index)
            li.classList.toggle('is-current', i === index)
            if (i === index) li.setAttribute('aria-current', 'step')
            else li.removeAttribute('aria-current')
        })
        const c = this.el.querySelector('.progress-compact')
        if (c && this.steps[index]) c.textContent = `Paso ${index + 1} de ${this.steps.length} · ${this.steps[index]}`
        this.el.setAttribute('aria-label', `Progreso: paso ${index + 1} de ${this.steps.length}, ${this.steps[index] ?? ''}`)
    }

    show(on) {
        this.el.hidden = !on
    }
}
