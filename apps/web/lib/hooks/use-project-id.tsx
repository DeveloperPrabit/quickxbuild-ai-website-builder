/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * use-project-id.tsx
 * Copyright (C) 2025 Nextify Limited
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

'use client'

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { useAgentBoardStore } from '@/components/ide/quickxbuild/hooks/use-agent-board-store'
import { useAgentRunStore } from '@/components/ide/quickxbuild/hooks/use-agent-run-store'
import { useMainViewStore } from '@/components/ide/quickxbuild/hooks/use-main-view-store'
import { usePreviewStore } from '@/components/ide/quickxbuild/hooks/use-preview-store'
import { useFileTreeStore } from '@/lib/hooks/use-file-tree-store'

interface ProjectContextProps {
  projectId: string
  projectName: string
  setProjectId: (id: string) => void
  setProjectName: (name: string) => void
}

const ProjectContext = createContext<ProjectContextProps | undefined>(undefined)

/**
 * ProjectProvider — route `projectId` is authoritative.
 * App Router reuses this layout client tree across /project/[id] navigations,
 * so a one-shot useState(initialId) would leave the previous project active.
 */
export const ProjectProvider = ({
  projectName: initialProjectName,
  projectId: initialProjectId,
  children,
}: {
  projectName: string
  projectId: string
  children: ReactNode
}) => {
  const [projectId, setProjectId] = useState(initialProjectId)
  const [projectName, setProjectName] = useState(initialProjectName)
  const previousProjectIdRef = useRef(initialProjectId)

  if (initialProjectId !== projectId) {
    setProjectId(initialProjectId)
    setProjectName(initialProjectName)
  }

  useEffect(() => {
    if (previousProjectIdRef.current === initialProjectId) {
      return
    }
    previousProjectIdRef.current = initialProjectId
    useFileTreeStore.getState().reset()
    useAgentBoardStore.getState().reset()
    useAgentRunStore.getState().reset()
    useMainViewStore.getState().backToLatest()
    usePreviewStore.getState().reset()
  }, [initialProjectId])

  return (
    <ProjectContext.Provider
      value={{
        projectId: initialProjectId,
        projectName,
        setProjectId,
        setProjectName,
      }}
    >
      <div key={initialProjectId} className='contents'>
        {children}
      </div>
    </ProjectContext.Provider>
  )
}

export const useProjectContext = () => {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectProvider')
  }
  return context
}
