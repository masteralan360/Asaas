import { barbadosStorefrontTemplate } from './barbados/BarbadosStorefrontTemplate'
import { genericStorefrontTemplate } from './generic/GenericStorefrontTemplate'
import type { StorefrontTemplate, StorefrontTemplateOptions } from './types'

export const DEFAULT_STOREFRONT_TEMPLATE_ID = 'generic' as const

/**
 * Add a new code-owned storefront design here. Each design supplies every
 * public storefront page, while shared hooks and APIs preserve commerce logic.
 */
export const storefrontTemplates = {
    barbados: barbadosStorefrontTemplate,
    generic: genericStorefrontTemplate
} satisfies Record<string, StorefrontTemplate>

export type StorefrontTemplateId = keyof typeof storefrontTemplates

export type StorefrontTemplateAssignment = {
    templateId: StorefrontTemplateId
    options?: StorefrontTemplateOptions
}

/**
 * V1 assignment source of truth. Add lower-case store slugs here when a
 * code-owned template is ready, for example:
 *
 * 'acme-baghdad': { templateId: 'acme', options: { heroImage: '/acme.jpg' } }
 */
export const storefrontTemplateAssignments: Readonly<Record<string, StorefrontTemplateAssignment>> = {
    barbados: { templateId: 'barbados' }
}

export type ResolvedStorefrontTemplate = {
    template: StorefrontTemplate
    options: StorefrontTemplateOptions
}

function normalizeStoreSlug(slug: string) {
    return slug.trim().toLowerCase()
}

/**
 * Resolves a URL slug entirely from code. Unknown or unassigned slugs always
 * render the current generic storefront to preserve existing public URLs.
 */
export function getStorefrontTemplateForSlug(slug: string): ResolvedStorefrontTemplate {
    const assignment = storefrontTemplateAssignments[normalizeStoreSlug(slug)]
    const template = assignment
        ? storefrontTemplates[assignment.templateId]
        : storefrontTemplates[DEFAULT_STOREFRONT_TEMPLATE_ID]

    return {
        template,
        options: assignment?.options ?? {}
    }
}
