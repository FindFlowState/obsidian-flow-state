export type { Database } from './generated.database.types';

import type { Database } from './generated.database.types';

// Canonical table type aliases (singular names)
export type User = Database["public"]["Tables"]["users"]["Row"];
export type UserInsert = Database["public"]["Tables"]["users"]["Insert"];
export type UserUpdate = Database["public"]["Tables"]["users"]["Update"];

export type Connection = Database["public"]["Tables"]["connections"]["Row"];
export type ConnectionInsert = Database["public"]["Tables"]["connections"]["Insert"];
export type ConnectionUpdate = Database["public"]["Tables"]["connections"]["Update"];

export type Route = Database["public"]["Tables"]["routes"]["Row"];
export type RouteInsert = Database["public"]["Tables"]["routes"]["Insert"];
export type RouteUpdate = Database["public"]["Tables"]["routes"]["Update"];

export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];
export type JobUpdate = Database["public"]["Tables"]["jobs"]["Update"];
export type JobStatus = Database["public"]["Enums"]["job_status"]

export type ContentType = Database["public"]["Enums"]["content_type"];
export type ServiceProvider = Database["public"]["Enums"]["service_type"];

// Shared destination config interfaces (used by clients and server)
export interface NotionDestinationConfig {
    parentType: "database" | "page";
    parentId: string;
    appendTargetId?: string | null;
  }
  
  export interface GoogleDestinationConfig {
    folderId?: string | null;
    docId?: string | null; // target for append
    appendTargetId?: string | null; // alias for docId
  }
  
  export interface OneNoteDestinationConfig {
    notebookId?: string | null;
    sectionId?: string | null;
    pageId?: string | null; // append target
  }
  
  // Shared route destination_config JSON shape (raw JSON column type)
  export type DestinationConfig = Database["public"]["Tables"]["routes"]["Row"]["destination_config"];
  