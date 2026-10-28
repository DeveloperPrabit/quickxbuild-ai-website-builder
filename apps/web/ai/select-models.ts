import { selectCapabilities } from './capabilities'

export const selectModel = (
  userPlan: string,
  selectedModelId?: string,
  isFileEdit = false
): string => {
  const capabilities = selectCapabilities(userPlan, selectedModelId, isFileEdit)
  return isFileEdit ? capabilities.fast : capabilities.reason
}

export const selectAgentModels = (
  userPlan: string,
  selectedModelId?: string,
  isFileEdit = false
): string[] => {
  const capabilities = selectCapabilities(userPlan, selectedModelId, isFileEdit)
  if (isFileEdit) {
    return [...new Set([capabilities.fast, capabilities.code])]
  }
  return [...new Set([capabilities.reason, capabilities.code, capabilities.fast])]
}
