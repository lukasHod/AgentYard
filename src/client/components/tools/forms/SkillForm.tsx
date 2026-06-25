import type { SkillTool } from '../../../../core/tools'
import { useObjectState } from '../../../hooks/useObjectState'
import {
  FormButtons,
  Label,
  NameDescriptionFields,
  textareaCls,
  type FormSubmissionState,
  type NameFieldEditability,
} from './formChrome'

export function SkillForm({
  initial,
  nameField,
  onSubmit,
  onCancel,
  submission,
}: {
  initial?: SkillTool
  nameField: NameFieldEditability
  onSubmit: (d: SkillTool) => void
  onCancel: () => void
  submission: FormSubmissionState
}) {
  const [form, set] = useObjectState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    body: initial?.body ?? '',
  })

  function submit() {
    if (!form.name.trim()) return alert('name is required')
    onSubmit({
      name: form.name.trim(),
      description: form.description.trim(),
      body: form.body,
    })
  }

  return (
    <div className="space-y-3">
      <NameDescriptionFields
        name={form.name}
        description={form.description}
        onName={(v) => set({ name: v })}
        onDescription={(v) => set({ description: v })}
        nameField={nameField}
      />
      <div>
        <Label hint="loaded into the drone's system prompt when this skill is attached">
          BODY (markdown)
        </Label>
        <textarea
          value={form.body}
          onChange={(e) => set({ body: e.target.value })}
          rows={18}
          className={textareaCls}
        />
      </div>
      <FormButtons onCancel={onCancel} onSubmit={submit} submission={submission} />
    </div>
  )
}
