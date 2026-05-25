export interface TestRunRequest {
  scope: 'workflow' | 'node'
  nodeId?: string
}

export const SYSTEM_TAB_ID = '__system__'
