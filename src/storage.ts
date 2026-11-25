// Storage-independent shapes the search modules work with. See
// storage-sqlite.ts for how OpenCode 2 session data maps onto them.

export interface Session {
  id: string;
  projectID: string;
  title: string;
  directory: string;
  time: { created: number; updated: number };
}

export interface Message {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  agent: string;
  time: { created: number };
}

export interface Part {
  id: string;
  messageID: string;
  sessionID: string;
  type: "text" | "tool" | "file" | "patch";
  text?: string;
  tool?: string;
  state?: {
    input?: any;
    output?: string;
    title?: string;
  };
  files?: string[]; // For patch parts — list of modified file paths
}
