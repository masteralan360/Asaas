import type { BusinessPartnerRole, RealEstateTransactionType } from '@/local-db'

type TranslateFn = (key: string, options?: { defaultValue?: string; [key: string]: unknown }) => string

type PartySpec = {
    label: string
    nativeLabel: string
}

type TransactionPartySpec = {
    buyer: PartySpec
    seller: PartySpec
}

const KU = {
    sideOne: '\u0644\u0627\u06cc\u06d5\u0646\u06cc \u06cc\u06d5\u06a9\u06d5\u0645',
    sideTwo: '\u0644\u0627\u06cc\u06d5\u0646\u06cc \u062f\u0648\u0648\u06d5\u0645',
    seller: '\u0641\u0631\u06c6\u0634\u06cc\u0627\u0631',
    buyer: '\u06a9\u0695\u06cc\u0627\u0631',
    landlord: '\u062e\u0627\u0648\u06d5\u0646 \u0645\u0648\u06b5\u06a9',
    tenant: '\u06a9\u0631\u06ce\u0686\u06cc',
    lessor: '\u0628\u06d5\u06a9\u0631\u06ce\u062f\u06d5\u0631',
    lessee: '\u0628\u06d5\u06a9\u0631\u06ce\u06af\u0631',
    firstParty: '\u0644\u0627\u06cc\u06d5\u0646\u06cc \u06cc\u06d5\u06a9\u06d5\u0645',
    secondParty: '\u0644\u0627\u06cc\u06d5\u0646\u06cc \u062f\u0648\u0648\u06d5\u0645',
    witness: '\u0634\u0627\u0647\u06cc\u062f',
    witnessOf: '\u0634\u0627\u0647\u06cc\u062f\u06cc',
    receiptNumber: '\u0698\u0645\u0627\u0631\u06d5\u06cc \u0648\u06d5\u0635\u0644',
    idLabel: '\u067e\u06ce\u0646\u0627\u0633',
    unknown: '\u0646\u0627\u0633\u0631\u0627\u0648\u06d5',
    nameOf: '\u0646\u0627\u0648\u06cc',
    addressOf: '\u0646\u0627\u0648\u0646\u06cc\u0634\u0627\u0646\u06cc',
    phoneOf: '\u0698\u0645\u0627\u0631\u06d5\u06cc \u062a\u06d5\u0644\u06d5\u0641\u06c6\u0646\u06cc',
    signatureOf: '\u0648\u0627\u0698\u06c6\u06cc',
    note: '\u062a\u06ce\u0628\u06cc\u0646\u06cc',
    write: '\u0628\u0646\u0648\u0648\u0633\u06d5'
}

const PARTY_SPECS: Record<RealEstateTransactionType, TransactionPartySpec> = {
    sell: {
        buyer: { label: 'Buyer', nativeLabel: KU.buyer },
        seller: { label: 'Seller', nativeLabel: KU.seller }
    },
    buy: {
        buyer: { label: 'Buyer', nativeLabel: KU.buyer },
        seller: { label: 'Seller', nativeLabel: KU.seller }
    },
    rent: {
        buyer: { label: 'Tenant', nativeLabel: KU.tenant },
        seller: { label: 'Landlord', nativeLabel: KU.landlord }
    },
    lease: {
        buyer: { label: 'Lessee', nativeLabel: KU.lessee },
        seller: { label: 'Lessor', nativeLabel: KU.lessor }
    },
    exchange: {
        buyer: { label: 'Second Party', nativeLabel: KU.secondParty },
        seller: { label: 'First Party', nativeLabel: KU.firstParty }
    }
}

export function getRealEstateTransactionTypeFromModuleTypeKey(moduleTypeKey?: string): RealEstateTransactionType {
    const typeKey = moduleTypeKey?.split('.').pop()?.toLowerCase()
    if (typeKey === 'buy' || typeKey === 'rent' || typeKey === 'lease' || typeKey === 'exchange') {
        return typeKey
    }
    return 'sell'
}

export function isSaleLikeRealEstateTransactionType(transactionType: RealEstateTransactionType) {
    return transactionType === 'sell' || transactionType === 'buy'
}

export function getInitialRealEstatePartnerRole(
    transactionType: RealEstateTransactionType,
    party: 'buyer' | 'seller'
): BusinessPartnerRole {
    if (!isSaleLikeRealEstateTransactionType(transactionType)) {
        return 'customer'
    }

    return party
}

export function getRealEstatePartyLabels(transactionType: RealEstateTransactionType, t: TranslateFn) {
    const spec = PARTY_SPECS[transactionType]
    const tr = (key: string, defaultValue: string) => t(key, { defaultValue })
    const scope = `realEstate.partyLabels.${transactionType}`

    const buildParty = (party: 'buyer' | 'seller') => {
        const label = tr(`${scope}.${party}`, spec[party].label)
        return {
            label,
            placeholder: tr(`${scope}.${party}Placeholder`, `Search or enter ${label.toLowerCase()} name`),
            linkedLabel: tr(`${scope}.linked${party === 'buyer' ? 'Buyer' : 'Seller'}`, `Linked ${label.toLowerCase()}`),
            witnessLabel: tr(`${scope}.${party}Witness`, `${label} Witness`),
            addButtonLabel: tr(`${scope}.${party}Add`, `Add ${label.toLowerCase()}`)
        }
    }

    return {
        buyer: buildParty('buyer'),
        seller: buildParty('seller'),
        duplicatePartnerMessage: tr(
            `${scope}.duplicatePartner`,
            'Both parties cannot use the same business partner.'
        )
    }
}

export function getRealEstateNativePrintLabels(transactionType: RealEstateTransactionType) {
    const spec = PARTY_SPECS[transactionType]

    return {
        receiptNumber: KU.receiptNumber,
        idLabel: KU.idLabel,
        unknown: KU.unknown,
        sellerHeader: `${KU.sideOne} / ${spec.seller.nativeLabel} :`,
        buyerHeader: `${KU.sideTwo} / ${spec.buyer.nativeLabel} :`,
        sellerWitnessTitle: `${KU.witnessOf} ${spec.seller.nativeLabel}:`,
        buyerWitnessTitle: `${KU.witnessOf} ${spec.buyer.nativeLabel}:`,
        sellerSignatureTitle: `${KU.sideOne} (${spec.seller.nativeLabel}):`,
        buyerSignatureTitle: `${KU.sideTwo} (${spec.buyer.nativeLabel}):`
    }
}

export function getRealEstateNativeFieldPlaceholders(transactionType: RealEstateTransactionType) {
    const spec = PARTY_SPECS[transactionType]
    const witnessOf = (partyLabel: string) => `${KU.witnessOf} ${partyLabel}`

    return {
        sellerWitnessName: `${KU.nameOf} ${witnessOf(spec.seller.nativeLabel)} ${KU.write}`,
        sellerWitnessAddress: `${KU.addressOf} ${witnessOf(spec.seller.nativeLabel)} ${KU.write}`,
        sellerWitnessPhone: `${KU.phoneOf} ${witnessOf(spec.seller.nativeLabel)} ${KU.write}`,
        sellerSignatureName: `${KU.nameOf} ${spec.seller.nativeLabel} ${KU.write}`,
        sellerSignatureAddress: `${KU.addressOf} ${spec.seller.nativeLabel} ${KU.write}`,
        sellerSignaturePhone: `${KU.phoneOf} ${spec.seller.nativeLabel} ${KU.write}`,
        buyerSignatureName: `${KU.nameOf} ${spec.buyer.nativeLabel} ${KU.write}`,
        buyerSignatureAddress: `${KU.addressOf} ${spec.buyer.nativeLabel} ${KU.write}`,
        buyerSignaturePhone: `${KU.phoneOf} ${spec.buyer.nativeLabel} ${KU.write}`,
        buyerWitnessName: `${KU.nameOf} ${witnessOf(spec.buyer.nativeLabel)} ${KU.write}`,
        buyerWitnessAddress: `${KU.addressOf} ${witnessOf(spec.buyer.nativeLabel)} ${KU.write}`,
        buyerWitnessPhone: `${KU.phoneOf} ${witnessOf(spec.buyer.nativeLabel)} ${KU.write}`
    }
}

export function getRealEstateNativeTemplateFieldLabels(transactionType: RealEstateTransactionType) {
    const spec = PARTY_SPECS[transactionType]
    const witnessOf = (partyLabel: string) => `${KU.witnessOf} ${partyLabel}`

    return {
        receiptNumber: KU.receiptNumber,
        sellerName: `${KU.nameOf} ${spec.seller.nativeLabel}`,
        sellerPhone: `${KU.idLabel} ${spec.seller.nativeLabel}`,
        buyerName: `${KU.nameOf} ${spec.buyer.nativeLabel}`,
        buyerPhone: `${KU.idLabel} ${spec.buyer.nativeLabel}`,
        sellerWitnessName: witnessOf(spec.seller.nativeLabel),
        sellerWitnessAddress: `${KU.addressOf} ${witnessOf(spec.seller.nativeLabel)}`,
        sellerWitnessPhone: `${KU.phoneOf} ${witnessOf(spec.seller.nativeLabel)}`,
        sellerSignatureName: `${KU.signatureOf} ${spec.seller.nativeLabel}`,
        sellerSignatureAddress: `${KU.addressOf} ${spec.seller.nativeLabel}`,
        sellerSignaturePhone: `${KU.phoneOf} ${spec.seller.nativeLabel}`,
        buyerSignatureName: `${KU.signatureOf} ${spec.buyer.nativeLabel}`,
        buyerSignatureAddress: `${KU.addressOf} ${spec.buyer.nativeLabel}`,
        buyerSignaturePhone: `${KU.phoneOf} ${spec.buyer.nativeLabel}`,
        buyerWitnessName: witnessOf(spec.buyer.nativeLabel),
        buyerWitnessAddress: `${KU.addressOf} ${witnessOf(spec.buyer.nativeLabel)}`,
        buyerWitnessPhone: `${KU.phoneOf} ${witnessOf(spec.buyer.nativeLabel)}`,
        note: KU.note
    }
}

export function getRealEstateTemplateKeyLabels(transactionType: RealEstateTransactionType) {
    const spec = PARTY_SPECS[transactionType]
    const buyer = spec.buyer.label
    const seller = spec.seller.label

    return {
        buyerGroup: buyer,
        sellerGroup: seller,
        buyerName: `${buyer} name`,
        buyerPhone: `${buyer} phone number`,
        buyerBusinessPartnerId: `${buyer} business partner ID`,
        buyerWitnessName: `${buyer} witness name`,
        buyerWitnessAddress: `${buyer} witness address`,
        buyerWitnessPhone: `${buyer} witness phone number`,
        sellerName: `${seller} name`,
        sellerPhone: `${seller} phone number`,
        sellerBusinessPartnerId: `${seller} business partner ID`,
        sellerWitnessName: `${seller} witness name`,
        sellerWitnessAddress: `${seller} witness address`,
        sellerWitnessPhone: `${seller} witness phone number`
    }
}
