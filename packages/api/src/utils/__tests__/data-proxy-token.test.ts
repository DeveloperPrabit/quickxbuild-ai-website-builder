import { describe, expect, it } from 'vitest'
import { issueDataProxyToken, verifyDataProxyToken } from '../data-proxy-token'

describe('data proxy tokens', () => {
  it('issues and verifies HMAC tokens', () => {
    process.env.DATA_PROXY_SECRET = 'test-data-proxy-secret-key'
    const token = issueDataProxyToken('proj_1', 'org_1')
    expect(token.startsWith('quickxbuild_dt_')).toBe(true)
    const claims = verifyDataProxyToken(`Bearer ${token}`)
    expect(claims).toEqual({ projectId: 'proj_1', tenantId: 'org_1', exp: 0 })
  })

  it('rejects tampered tokens', () => {
    process.env.DATA_PROXY_SECRET = 'test-data-proxy-secret-key'
    const token = issueDataProxyToken('proj_1', 'org_1')
    expect(verifyDataProxyToken(`${token}x`)).toBeNull()
    expect(verifyDataProxyToken(null)).toBeNull()
  })
})
