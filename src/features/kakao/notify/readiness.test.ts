import { describe, expect, it } from 'vitest'
import {
  evaluateAlimtalkReadiness,
  REQUIRED_ALIMTALK_CONFIG_KEYS,
  type AlimtalkReadiness,
} from './readiness'
import { ALIMTALK_TEMPLATE_LIST } from './templates'

describe('evaluateAlimtalkReadiness', () => {
  const ALL_KNOWN_TEMPLATE_CODES = ALIMTALK_TEMPLATE_LIST.map((t) => t.code)

  const VALID_CONFIG_MAP = {
    SOLAPI_API_KEY: 'test-api-key',
    SOLAPI_API_SECRET: 'test-api-secret',
    SOLAPI_PF_ID: 'test-pf-id',
    SOLAPI_WEBHOOK_SECRET: 'test-webhook-secret',
  }

  const FULL_VALID_TEMPLATE_MAP: Record<string, string> = {
    SOHEE_BOOKING_CONFIRMED_V1: 'KA01TP240001',
    SOHEE_BOOKING_CHANGED_V1: 'KA01TP240002',
    SOHEE_BOOKING_CANCELLED_V1: 'KA01TP240003',
    SOHEE_PAYMENT_CONFIRMED_V1: 'KA01TP240004',
    SOHEE_REMINDER_24H_V1: 'KA01TP240005',
    SOHEE_REMINDER_2H_V1: 'KA01TP240006',
  }

  describe('REQUIRED_ALIMTALK_CONFIG_KEYS', () => {
    it('defines the 4 required configuration keys', () => {
      expect(REQUIRED_ALIMTALK_CONFIG_KEYS).toEqual([
        'SOLAPI_API_KEY',
        'SOLAPI_API_SECRET',
        'SOLAPI_PF_ID',
        'SOLAPI_WEBHOOK_SECRET',
      ])
    })
  })

  describe('empty / missing environment', () => {
    it('returns not ready with all missing keys and all 6 unmapped templates', () => {
      const res = evaluateAlimtalkReadiness({})

      expect(res).toEqual<AlimtalkReadiness>({
        configurationReady: false,
        liveEnabled: false,
        missing: [
          'SOLAPI_API_KEY',
          'SOLAPI_API_SECRET',
          'SOLAPI_PF_ID',
          'SOLAPI_WEBHOOK_SECRET',
        ],
        unmappedTemplateCodes: ALL_KNOWN_TEMPLATE_CODES,
        approvalVerified: false,
        deliveryVerified: false,
      })
    })

    it('treats whitespace-only values as missing', () => {
      const res = evaluateAlimtalkReadiness({
        SOLAPI_API_KEY: '   ',
        SOLAPI_API_SECRET: '\t\n',
        SOLAPI_PF_ID: '',
        SOLAPI_WEBHOOK_SECRET: 'valid-secret',
      })

      expect(res.missing).toEqual([
        'SOLAPI_API_KEY',
        'SOLAPI_API_SECRET',
        'SOLAPI_PF_ID',
      ])
    })
  })

  describe('template mapping validation (SOLAPI_TEMPLATE_IDS)', () => {
    it('rejects invalid JSON string and reports all known templates unmapped', () => {
      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: '{invalid-json',
      })

      expect(res.missing).toEqual([])
      expect(res.unmappedTemplateCodes).toEqual(ALL_KNOWN_TEMPLATE_CODES)
      expect(res.configurationReady).toBe(false)
    })

    it('rejects JSON arrays and primitives', () => {
      const arrayRes = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(['SOHEE_BOOKING_CONFIRMED_V1']),
      })
      expect(arrayRes.unmappedTemplateCodes).toEqual(ALL_KNOWN_TEMPLATE_CODES)

      const stringRes = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify('simple-string'),
      })
      expect(stringRes.unmappedTemplateCodes).toEqual(ALL_KNOWN_TEMPLATE_CODES)

      const numberRes = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: '12345',
      })
      expect(numberRes.unmappedTemplateCodes).toEqual(ALL_KNOWN_TEMPLATE_CODES)
    })

    it('rejects inherited prototype properties and only accepts own properties', () => {
      // Prototype pollution / inherited keys shouldn't be counted as mapped
      const inheritedObj = Object.create({
        SOHEE_BOOKING_CONFIRMED_V1: 'inherited-tpl-id',
      })
      inheritedObj.SOHEE_BOOKING_CHANGED_V1 = 'own-tpl-id'

      // Emulate JSON parsed from attacker or non-own prototype
      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(inheritedObj),
      })

      // In JSON.stringify, non-enumerable / prototype keys are dropped, so only BOOKING_CHANGED is own
      expect(res.unmappedTemplateCodes).toContain('SOHEE_BOOKING_CONFIRMED_V1')
      expect(res.unmappedTemplateCodes).not.toContain('SOHEE_BOOKING_CHANGED_V1')
    })

    it('rejects blank, non-string, or empty template ID mappings', () => {
      const partialMap = {
        SOHEE_BOOKING_CONFIRMED_V1: '   ', // blank
        SOHEE_BOOKING_CHANGED_V1: '', // empty
        SOHEE_BOOKING_CANCELLED_V1: 12345, // non-string
        SOHEE_PAYMENT_CONFIRMED_V1: null, // null
        SOHEE_REMINDER_24H_V1: 'KA01TP240005', // valid
        SOHEE_REMINDER_2H_V1: undefined, // undefined
      }

      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(partialMap),
      })

      expect(res.unmappedTemplateCodes).toEqual([
        'SOHEE_BOOKING_CONFIRMED_V1',
        'SOHEE_BOOKING_CHANGED_V1',
        'SOHEE_BOOKING_CANCELLED_V1',
        'SOHEE_PAYMENT_CONFIRMED_V1',
        'SOHEE_REMINDER_2H_V1',
      ])
      expect(res.configurationReady).toBe(false)
    })

    it('ignores unknown template keys and only evaluates known 6 templates', () => {
      const mapWithExtras = {
        ...FULL_VALID_TEMPLATE_MAP,
        UNKNOWN_TEMPLATE_KEY_V9: 'KA01TP_UNKNOWN',
        constructor: 'polluted',
        toString: 'polluted',
      }

      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(mapWithExtras),
      })

      expect(res.unmappedTemplateCodes).toEqual([])
      expect(res.configurationReady).toBe(true)
    })
  })

  describe('configurationReady and liveEnabled', () => {
    it('is not configurationReady if even one template is unmapped', () => {
      const missingOneTpl = { ...FULL_VALID_TEMPLATE_MAP }
      delete missingOneTpl.SOHEE_REMINDER_2H_V1

      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(missingOneTpl),
        SOLAPI_ENABLED: 'true',
      })

      expect(res.configurationReady).toBe(false)
      expect(res.liveEnabled).toBe(false)
      expect(res.unmappedTemplateCodes).toEqual(['SOHEE_REMINDER_2H_V1'])
    })

    it('is not configurationReady if even one required config key is missing', () => {
      const res = evaluateAlimtalkReadiness({
        SOLAPI_API_KEY: 'test-api-key',
        SOLAPI_API_SECRET: 'test-api-secret',
        SOLAPI_PF_ID: 'test-pf-id',
        // SOLAPI_WEBHOOK_SECRET missing
        SOLAPI_TEMPLATE_IDS: JSON.stringify(FULL_VALID_TEMPLATE_MAP),
        SOLAPI_ENABLED: 'true',
      })

      expect(res.configurationReady).toBe(false)
      expect(res.liveEnabled).toBe(false)
      expect(res.missing).toEqual(['SOLAPI_WEBHOOK_SECRET'])
      expect(res.unmappedTemplateCodes).toEqual([])
    })

    it('is configurationReady when all 4 keys and all 6 templates are present', () => {
      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(FULL_VALID_TEMPLATE_MAP),
      })

      expect(res.configurationReady).toBe(true)
      expect(res.missing).toEqual([])
      expect(res.unmappedTemplateCodes).toEqual([])
      // SOLAPI_ENABLED is not 'true'
      expect(res.liveEnabled).toBe(false)
    })

    it('is liveEnabled when configurationReady and SOLAPI_ENABLED === "true"', () => {
      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(FULL_VALID_TEMPLATE_MAP),
        SOLAPI_ENABLED: 'true',
      })

      expect(res.configurationReady).toBe(true)
      expect(res.liveEnabled).toBe(true)
    })

    it('never reports approvalVerified or deliveryVerified as true', () => {
      const res = evaluateAlimtalkReadiness({
        ...VALID_CONFIG_MAP,
        SOLAPI_TEMPLATE_IDS: JSON.stringify(FULL_VALID_TEMPLATE_MAP),
        SOLAPI_ENABLED: 'true',
      })

      // Setting template ID in JSON does NOT imply approval or successful delivery
      expect(res.approvalVerified).toBe(false)
      expect(res.deliveryVerified).toBe(false)
    })
  })

  describe('security and leakage prevention', () => {
    it('does not leak secret values or template ID values in output', () => {
      const CANARY_API_KEY = 'canary-super-secret-api-key-999'
      const CANARY_API_SECRET = 'canary-super-secret-api-secret-888'
      const CANARY_PF_ID = 'canary-pf-id-777'
      const CANARY_WEBHOOK_SECRET = 'canary-webhook-secret-666'
      const CANARY_TPL_ID_1 = 'canary-solapi-tpl-id-555'

      const res = evaluateAlimtalkReadiness({
        SOLAPI_API_KEY: CANARY_API_KEY,
        SOLAPI_API_SECRET: CANARY_API_SECRET,
        SOLAPI_PF_ID: CANARY_PF_ID,
        SOLAPI_WEBHOOK_SECRET: CANARY_WEBHOOK_SECRET,
        SOLAPI_TEMPLATE_IDS: JSON.stringify({
          SOHEE_BOOKING_CONFIRMED_V1: CANARY_TPL_ID_1,
        }),
      })

      const serialized = JSON.stringify(res)
      expect(serialized).not.toContain(CANARY_API_KEY)
      expect(serialized).not.toContain(CANARY_API_SECRET)
      expect(serialized).not.toContain(CANARY_PF_ID)
      expect(serialized).not.toContain(CANARY_WEBHOOK_SECRET)
      expect(serialized).not.toContain(CANARY_TPL_ID_1)

      // Only known template code strings and env var keys are allowed
      expect(res.unmappedTemplateCodes).toContain('SOHEE_BOOKING_CHANGED_V1')
    })
  })
})
