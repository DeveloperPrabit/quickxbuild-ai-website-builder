/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * use-main-view-store.ts — Which surface the main (left) pane shows: live preview or run Details
 */

import { create } from 'zustand'

export type MainView = 'preview' | 'details'

type MainViewState = {
  view: MainView
  /** planId of the run shown in Details; null follows the latest run. */
  detailsPlanId: string | null
  openDetails: (planId: string | null) => void
  backToLatest: () => void
}

export const useMainViewStore = create<MainViewState>((set) => ({
  view: 'preview',
  detailsPlanId: null,
  openDetails: (planId) => set({ view: 'details', detailsPlanId: planId }),
  backToLatest: () => set({ view: 'preview', detailsPlanId: null }),
}))
