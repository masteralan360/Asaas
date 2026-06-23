import { describe, expect, it } from 'vitest'
import {
    A4_PAGE_HEIGHT_MM,
    getCustomTemplateLayoutHeightMm,
    getCustomTemplateLayoutPageCount
} from './pdfPreviewStore'
import type { CustomTemplateLayout } from './pdfPreviewStore'

function createLayout(overrides: Partial<CustomTemplateLayout> = {}): CustomTemplateLayout {
    return {
        version: 1,
        moduleTypeKey: 'test.A4',
        page: { widthMm: 210, heightMm: A4_PAGE_HEIGHT_MM },
        fields: {},
        annotations: [],
        texts: [],
        images: [],
        updatedAt: '2026-06-23T00:00:00.000Z',
        ...overrides
    }
}

describe('custom template page extents', () => {
    it('keeps an empty A4 template to one fixed page', () => {
        const layout = createLayout()

        expect(getCustomTemplateLayoutHeightMm(layout)).toBe(A4_PAGE_HEIGHT_MM)
        expect(getCustomTemplateLayoutPageCount(layout)).toBe(1)
    })

    it('creates another A4 page when a moved component crosses the page bottom', () => {
        const layout = createLayout({
            componentPositions: {
                totals: { x: 0, y: A4_PAGE_HEIGHT_MM + 5 }
            }
        })

        expect(getCustomTemplateLayoutPageCount(layout)).toBe(2)
    })

    it('creates another A4 page when an annotation crosses the page bottom', () => {
        const layout = createLayout({
            annotations: [{
                type: 'pen',
                color: '#000000',
                brushSize: 2,
                points: [{ x: 10, y: A4_PAGE_HEIGHT_MM + 1 }]
            }]
        })

        expect(getCustomTemplateLayoutPageCount(layout)).toBe(2)
    })
})
