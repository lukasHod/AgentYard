import { useState } from 'react'
import type { SkillTool } from '../../../../core/tools'
import { FormButtons, Label, NameDescriptionFields, textareaCls } from './formChrome'

export function SkillForm({
  initial,
  disableName,
  onSubmit,
  onCancel,
  saving,
}: {
  initial?: SkillTool
  disableName: boolean
  onSubmit: (d: SkillTool) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [body, setBody] = useState(initial?.body ?? '')

  function submit() {
    if (!name.trim()) return alert('name is required')
    onSubmit({ name: name.trim(), description: description.trim(), body })
  }

  return (
    <div className="space-y-3">
      <NameDescriptionFields
        name={name}
        description={description}
        onName={setName}
        onDescription={setDescription}
        disableName={disableName}
      />
      <div>
        <Label hint="loaded into the drone's system prompt when this skill is attached">
          BODY (markdown)
        </Label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          className={textareaCls}
        />
      </div>
      <FormButtons onCancel={onCancel} onSubmit={submit} saving={saving} />
    </div>
  )
}
