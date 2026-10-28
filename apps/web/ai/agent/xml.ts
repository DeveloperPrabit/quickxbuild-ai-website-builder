export type AgentWrite = {
  path: string
  content: string
  description: string
}

export function synthesizePlanXml(
  thinking: string,
  description: string,
  writes: AgentWrite[]
): string {
  const actions = writes
    .map((write) => {
      return `<action type="file">
<description><![CDATA[${write.description || `Update ${write.path}`}]]></description>
<file filename="${write.path}"><![CDATA[${write.content}]]></file>
</action>`
    })
    .join('\n')

  return `<plan>
<thinking>
<![CDATA[
${thinking || 'Implementing the requested file changes.'}
]]>
</thinking>
<planDescription>
<![CDATA[
${description || 'Applied file updates for the user request.'}
]]>
</planDescription>
${actions}
</plan>`
}
