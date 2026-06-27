import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Page object for the Workflow Editor overlay.
 * The editor renders inside a modal on top of the 3D canvas.
 */
export class WorkflowEditorPage {
  readonly reactFlowCanvas: Locator
  readonly saveButton: Locator
  readonly addAiNodeButton: Locator
  readonly addScriptNodeButton: Locator
  readonly deleteButton: Locator

  constructor(readonly page: Page) {
    this.reactFlowCanvas = page.locator('.react-flow')
    this.saveButton = page.getByRole('button', { name: /^save$|^saved ✓$|^saving/ })
    this.addAiNodeButton = page.getByRole('button', { name: '+ AI node' })
    this.addScriptNodeButton = page.getByRole('button', { name: '+ script node' })
    this.deleteButton = page.getByRole('button', { name: 'delete' })
  }

  /** Wait for the editor overlay to be fully visible. */
  async waitForReady() {
    await this.reactFlowCanvas.waitFor({ timeout: 10_000 })
  }

  /** Close the editor by pressing Escape. */
  async close() {
    await this.page.keyboard.press('Escape')
    await this.reactFlowCanvas.waitFor({ state: 'hidden', timeout: 5_000 })
  }

  /** Add a new AI node and return the node's ID attribute. */
  async addAiNode(): Promise<string> {
    const beforeCount = await this.page.locator('.react-flow__node[data-type="workflow"]').count()
    await this.addAiNodeButton.click()
    // Wait for one more workflow node to appear.
    await expect(this.page.locator('.react-flow__node[data-type="workflow"]')).toHaveCount(
      beforeCount + 1,
      { timeout: 5_000 },
    )
    // The newly added node becomes selected — get the selected node ID.
    const selectedNode = this.page.locator('.react-flow__node.selected').first()
    return (await selectedNode.getAttribute('data-id')) ?? ''
  }

  /** Click a workflow node by its title text. */
  async clickNodeByTitle(title: string) {
    const node = this.page
      .locator('.react-flow__node')
      .filter({ hasText: title })
      .first()
    await node.click()
    // Wait for sidebar to update.
    await this.page.waitForTimeout(300)
  }

  /** Get all visible agent sub-nodes on the canvas. */
  agentSubNodes() {
    return this.page.locator('.react-flow__node[data-type="agentSub"]')
  }

  /** Get agent sub-node by agent name. */
  agentSubNodeByName(agentName: string) {
    return this.page
      .locator('.react-flow__node[data-type="agentSub"]')
      .filter({ hasText: agentName })
      .first()
  }

  /** Get all skill sub-nodes on the canvas. */
  skillSubNodes() {
    return this.page.locator('.react-flow__node[data-type="skillSub"]')
  }

  /** Get skill sub-node by skill name. */
  skillSubNodeByName(skillName: string) {
    return this.page
      .locator('.react-flow__node[data-type="skillSub"]')
      .filter({ hasText: skillName })
      .first()
  }

  /** Check the checkbox for an agent in the right-panel agent list. */
  async attachAgent(agentName: string) {
    const label = this.page.locator('label').filter({ hasText: agentName }).first()
    const checkbox = label.locator('input[type="checkbox"]')
    if (!(await checkbox.isChecked())) {
      await checkbox.check()
    }
    // Wait for the agent sub-node to appear.
    await this.agentSubNodeByName(agentName).waitFor({ timeout: 5_000 })
  }

  /** Uncheck the checkbox for an agent in the right-panel agent list. */
  async detachAgent(agentName: string) {
    const label = this.page.locator('label').filter({ hasText: agentName }).first()
    const checkbox = label.locator('input[type="checkbox"]')
    if (await checkbox.isChecked()) {
      await checkbox.uncheck()
    }
  }

  /** Click save and wait for "saved ✓". */
  async save() {
    await this.page.getByRole('button', { name: 'save' }).click()
    await expect(this.page.getByRole('button', { name: 'saved ✓' })).toBeVisible({ timeout: 10_000 })
  }

  /** Get the bounding box of a node on the canvas. */
  async getNodePosition(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox()
    if (!box) throw new Error('Node not found or not visible')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  /** Drag a node to a new relative offset. */
  async dragNode(locator: Locator, dx: number, dy: number) {
    const pos = await this.getNodePosition(locator)
    await this.page.mouse.move(pos.x, pos.y)
    await this.page.mouse.down()
    await this.page.mouse.move(pos.x + dx, pos.y + dy, { steps: 10 })
    await this.page.mouse.up()
    await this.page.waitForTimeout(300)
  }
}
