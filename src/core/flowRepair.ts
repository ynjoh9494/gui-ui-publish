export interface FlowRepairImage {
  nodeId: string; pageId: string; name: string; flowId: string; uid: string; stamp: string; imageHash?: string;
}
export interface FlowRepairCandidate extends FlowRepairImage { assignedUid: string | null }
export interface FlowRepairResult { restored: string[]; failed: { nodeId: string; message: string }[] }
