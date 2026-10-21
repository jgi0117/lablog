import { describe, expect, it } from 'vitest'
import { APP_ROUTE_PATHS } from '../app/routes'

const IA_ROUTE_PATHS = [
  '/',
  '/projects',
  '/projects/:id',
  '/projects/:id/requirements',
  '/projects/:id/data',
  '/projects/:id/analysis',
  '/experiments',
  '/experiments/new',
  '/experiments/:id',
  '/experiments/:id/steps',
  '/experiments/:id/run',
  '/experiments/:id/data',
  '/experiments/:id/deviations',
  '/data',
  '/data/analysis',
  '/data/export',
  '/trash',
  '/migrate',
  '/settings',
] as const

describe('IA와 앱 라우트', () => {
  it('IA Site Map의 공개 주소와 routes.tsx 목록이 일치한다', () => {
    expect([...APP_ROUTE_PATHS].sort()).toEqual([...IA_ROUTE_PATHS].sort())
  })
})
