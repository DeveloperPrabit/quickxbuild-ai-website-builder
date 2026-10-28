/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * type.ts
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

export type DescriptionChunkType = {
    type: 'description' | 'description_complete';
    planId: string;
    data: { content: string };
};

export type ThinkingChunkType = {
    type: 'thinking' | 'thinking_complete';
    planId: string;
    data: { content: string };
};

export type ResearchChunkType = {
    type: 'research';
    planId: string;
    data: { content: string };
};

export type TasksChunkType = {
    type: 'tasks';
    planId: string;
    data: {
        tasks: Array<{
            id: string
            title: string
            agent: string
            status: string
            files: string[]
            reason?: string
        }>
    };
};

export type ApplyStatusChunkType = {
    type: 'apply_failed' | 'apply_ok' | 'preview_ready';
    planId: string;
    data: { content: string };
};

export type ProgressChunkType = {
    type: 'progress';
    planId: string;
    data: { content: string };
};

export type TimelineChunkType = {
    type: 'timeline';
    planId: string;
    data: {
        kind: 'thought' | 'check' | 'edit' | 'verify' | 'summary' | 'terminal';
        title: string;
        detail?: string;
        path?: string;
        durationMs?: number;
        status?: 'running' | 'done' | 'failed';
        id?: string;
    };
};

export type BuildPlanChunkType = {
    type: 'build_plan';
    planId: string;
    data: {
        brandName?: string;
        vertical?: string;
        items: Array<{
            id: string;
            label: string;
            status: 'pending' | 'running' | 'done' | 'failed';
        }>;
    };
};

export type SummaryChunkType = {
    type: 'summary';
    planId: string;
    data: { content: string };
};

type FileActionChunkType = {
    type: 'file';
    description: string;
    modified: string;
    original: string | null;
    basename: string;
    dirname: string;
    path: string;
    isNew?: boolean;
};

type CommandActionChunkType = {
    type: 'command';
    description: string;
    command: 'bun install';
    packages: string[];
};

export type ActionChunkType = {
    type: 'action';
    planId: string;
    data: FileActionChunkType | CommandActionChunkType ;
};