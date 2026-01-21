/**
 * Cypher queries for Neo4j Checkpoint Saver
 *
 * These queries implement a graph model for storing LangGraph checkpoints:
 * - (:Thread)-[:HAS_CHECKPOINT]->(:Checkpoint)-[:PREVIOUS]->(:Checkpoint)
 * - (:Checkpoint)-[:HAS_CHANNEL]->(:ChannelState)
 * - (:Checkpoint)-[:HAS_WRITE]->(:PendingWrite)
 * - (:Thread)-[:HAS_BRANCH]->(:Branch)-[:HEAD]->(:Checkpoint)
 */

// =============================================================================
// Schema Setup - Constraints
// =============================================================================

export const CYPHER_CREATE_THREAD_CONSTRAINT = `
CREATE CONSTRAINT thread_unique IF NOT EXISTS
FOR (t:Thread) REQUIRE (t.thread_id, t.checkpoint_ns) IS UNIQUE
`;

export const CYPHER_CREATE_CHECKPOINT_CONSTRAINT = `
CREATE CONSTRAINT checkpoint_id_unique IF NOT EXISTS
FOR (c:Checkpoint) REQUIRE c.checkpoint_id IS UNIQUE
`;

export const CYPHER_CREATE_CHANNEL_STATE_CONSTRAINT = `
CREATE CONSTRAINT channel_state_unique IF NOT EXISTS
FOR (cs:ChannelState) REQUIRE (cs.channel, cs.version) IS UNIQUE
`;

export const CYPHER_CREATE_BRANCH_CONSTRAINT = `
CREATE CONSTRAINT branch_id_unique IF NOT EXISTS
FOR (b:Branch) REQUIRE b.branch_id IS UNIQUE
`;

// =============================================================================
// Schema Setup - Indexes
// =============================================================================

export const CYPHER_CREATE_CHECKPOINT_ID_INDEX = `
CREATE INDEX checkpoint_id_idx IF NOT EXISTS
FOR (c:Checkpoint) ON (c.checkpoint_id)
`;

export const CYPHER_CREATE_CHECKPOINT_CREATED_INDEX = `
CREATE INDEX checkpoint_created_idx IF NOT EXISTS
FOR (c:Checkpoint) ON (c.created_at)
`;

export const CYPHER_CREATE_BRANCH_NAME_INDEX = `
CREATE INDEX branch_name_idx IF NOT EXISTS
FOR (b:Branch) ON (b.name)
`;

// =============================================================================
// Checkpoint CRUD Operations
// =============================================================================

/**
 * Create/update Thread and Checkpoint with HAS_CHECKPOINT relationship
 * Simple version for Neo4j 5.0+ compatibility
 */
export const CYPHER_UPSERT_CHECKPOINT_SIMPLE = `
MERGE (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
CREATE (c:Checkpoint {
    checkpoint_id: $checkpoint_id,
    type: $type,
    checkpoint: $checkpoint,
    metadata: $metadata,
    created_at: datetime()
})
CREATE (t)-[:HAS_CHECKPOINT]->(c)
RETURN c.checkpoint_id as checkpoint_id
`;

/**
 * Link checkpoint to parent via PREVIOUS relationship
 */
export const CYPHER_LINK_PARENT_CHECKPOINT = `
MATCH (c:Checkpoint {checkpoint_id: $checkpoint_id})
MATCH (parent:Checkpoint {checkpoint_id: $parent_checkpoint_id})
MERGE (c)-[:PREVIOUS]->(parent)
`;

/**
 * Create ChannelState and link to Checkpoint with HAS_CHANNEL relationship
 */
export const CYPHER_UPSERT_CHANNEL_STATE = `
MATCH (c:Checkpoint {checkpoint_id: $checkpoint_id})
MERGE (cs:ChannelState {channel: $channel, version: $version})
ON CREATE SET cs.type = $type, cs.blob = $blob
CREATE (c)-[:HAS_CHANNEL]->(cs)
`;

/**
 * Create PendingWrite and link to Checkpoint with HAS_WRITE relationship
 */
export const CYPHER_UPSERT_WRITE = `
MATCH (c:Checkpoint {checkpoint_id: $checkpoint_id})
CREATE (w:PendingWrite {
    task_id: $task_id,
    task_path: $task_path,
    idx: $idx,
    channel: $channel,
    type: $type,
    blob: $blob
})
CREATE (c)-[:HAS_WRITE]->(w)
`;

/**
 * Get checkpoint by ID with relationships
 */
export const CYPHER_GET_CHECKPOINT_BY_ID = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:HAS_CHECKPOINT]->(c:Checkpoint {checkpoint_id: $checkpoint_id})
OPTIONAL MATCH (c)-[:PREVIOUS]->(parent:Checkpoint)
RETURN t.thread_id as thread_id,
       t.checkpoint_ns as checkpoint_ns,
       c.checkpoint_id as checkpoint_id,
       parent.checkpoint_id as parent_checkpoint_id,
       c.type as type,
       c.checkpoint as checkpoint,
       c.metadata as metadata
`;

/**
 * Get latest checkpoint for thread (fallback when no branches)
 */
export const CYPHER_GET_LATEST_CHECKPOINT = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:HAS_CHECKPOINT]->(c:Checkpoint)
WITH t, c ORDER BY c.checkpoint_id DESC LIMIT 1
OPTIONAL MATCH (c)-[:PREVIOUS]->(parent:Checkpoint)
RETURN t.thread_id as thread_id,
       t.checkpoint_ns as checkpoint_ns,
       c.checkpoint_id as checkpoint_id,
       parent.checkpoint_id as parent_checkpoint_id,
       c.type as type,
       c.checkpoint as checkpoint,
       c.metadata as metadata
`;

/**
 * Get channel states for a checkpoint
 */
export const CYPHER_GET_CHANNEL_STATES = `
MATCH (c:Checkpoint {checkpoint_id: $checkpoint_id})
      -[:HAS_CHANNEL]->(cs:ChannelState)
WHERE cs.channel IN $channels AND cs.version IN $versions
RETURN cs.channel as channel,
       cs.type as type,
       cs.blob as blob,
       cs.version as version
`;

/**
 * Get pending writes for a checkpoint
 */
export const CYPHER_GET_WRITES = `
MATCH (c:Checkpoint {checkpoint_id: $checkpoint_id})
      -[:HAS_WRITE]->(w:PendingWrite)
RETURN w.task_id as task_id,
       w.task_path as task_path,
       w.channel as channel,
       w.type as type,
       w.blob as blob,
       w.idx as idx
ORDER BY w.idx
`;

/**
 * List checkpoints for a thread with pagination
 */
export const CYPHER_LIST_CHECKPOINTS = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:HAS_CHECKPOINT]->(c:Checkpoint)
WHERE $before_id IS NULL OR c.checkpoint_id < $before_id
WITH t, c ORDER BY c.checkpoint_id DESC LIMIT $limit
OPTIONAL MATCH (c)-[:PREVIOUS]->(parent:Checkpoint)
RETURN t.thread_id as thread_id,
       t.checkpoint_ns as checkpoint_ns,
       c.checkpoint_id as checkpoint_id,
       parent.checkpoint_id as parent_checkpoint_id,
       c.type as type,
       c.checkpoint as checkpoint,
       c.metadata as metadata
`;

// =============================================================================
// Delete Operations
// =============================================================================

/**
 * Delete thread and all related data (cascade via relationships)
 */
export const CYPHER_DELETE_THREAD = `
MATCH (t:Thread {thread_id: $thread_id})
OPTIONAL MATCH (t)-[:HAS_CHECKPOINT]->(c:Checkpoint)
OPTIONAL MATCH (c)-[:HAS_WRITE]->(w:PendingWrite)
OPTIONAL MATCH (t)-[:HAS_BRANCH]->(b:Branch)
DETACH DELETE t, c, w, b
`;

/**
 * Clean up orphaned ChannelState nodes (not connected to any checkpoint)
 */
export const CYPHER_DELETE_ORPHAN_CHANNEL_STATES = `
MATCH (cs:ChannelState)
WHERE NOT (cs)<-[:HAS_CHANNEL]-()
DELETE cs
`;

// =============================================================================
// Branch Operations (Time-Travel Support)
// =============================================================================

/**
 * Create the main branch for a thread (called on first checkpoint)
 */
export const CYPHER_CREATE_MAIN_BRANCH = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
WHERE NOT (t)-[:HAS_BRANCH]->()
CREATE (b:Branch {
    branch_id: $branch_id,
    name: 'main',
    created_at: datetime(),
    fork_point_id: null
})
CREATE (t)-[:HAS_BRANCH]->(b)
CREATE (t)-[:ACTIVE_BRANCH]->(b)
RETURN b.branch_id as branch_id
`;

/**
 * Create a new branch (fork) from a checkpoint
 */
export const CYPHER_CREATE_BRANCH = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
CREATE (b:Branch {
    branch_id: $branch_id,
    name: $name,
    created_at: datetime(),
    fork_point_id: $fork_point_id
})
CREATE (t)-[:HAS_BRANCH]->(b)
WITH t, b
MATCH (c:Checkpoint {checkpoint_id: $fork_point_id})
CREATE (b)-[:HEAD]->(c)
RETURN b.branch_id as branch_id
`;

/**
 * Set active branch for a thread
 */
export const CYPHER_SET_ACTIVE_BRANCH = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
OPTIONAL MATCH (t)-[old:ACTIVE_BRANCH]->()
DELETE old
WITH t
MATCH (t)-[:HAS_BRANCH]->(b:Branch {branch_id: $branch_id})
CREATE (t)-[:ACTIVE_BRANCH]->(b)
RETURN b.branch_id as branch_id
`;

/**
 * Update branch HEAD and link checkpoint to branch
 */
export const CYPHER_UPDATE_BRANCH_HEAD = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:ACTIVE_BRANCH]->(b:Branch)
OPTIONAL MATCH (b)-[old:HEAD]->()
DELETE old
WITH b
MATCH (c:Checkpoint {checkpoint_id: $checkpoint_id})
CREATE (b)-[:HEAD]->(c)
MERGE (c)-[:ON_BRANCH]->(b)
RETURN b.branch_id as branch_id
`;

/**
 * Get active branch HEAD checkpoint
 */
export const CYPHER_GET_ACTIVE_BRANCH_HEAD = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:ACTIVE_BRANCH]->(b:Branch)
      -[:HEAD]->(c:Checkpoint)
OPTIONAL MATCH (c)-[:PREVIOUS]->(parent:Checkpoint)
RETURN t.thread_id as thread_id,
       t.checkpoint_ns as checkpoint_ns,
       c.checkpoint_id as checkpoint_id,
       parent.checkpoint_id as parent_checkpoint_id,
       c.type as type,
       c.checkpoint as checkpoint,
       c.metadata as metadata,
       b.branch_id as branch_id,
       b.name as branch_name
`;

/**
 * Check if thread has any branches (for migration/setup)
 */
export const CYPHER_THREAD_HAS_BRANCHES = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
OPTIONAL MATCH (t)-[:HAS_BRANCH]->(b:Branch)
RETURN t.thread_id as thread_id, count(b) as branch_count
`;

/**
 * List all branches for a thread
 */
export const CYPHER_LIST_BRANCHES = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:HAS_BRANCH]->(b:Branch)
OPTIONAL MATCH (t)-[active:ACTIVE_BRANCH]->(b)
OPTIONAL MATCH (b)-[:HEAD]->(head:Checkpoint)
RETURN b.branch_id as branch_id,
       b.name as name,
       b.created_at as created_at,
       b.fork_point_id as fork_point_id,
       active IS NOT NULL as is_active,
       head.checkpoint_id as head_checkpoint_id
ORDER BY b.created_at
`;

/**
 * Get active branch info
 */
export const CYPHER_GET_ACTIVE_BRANCH = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:ACTIVE_BRANCH]->(b:Branch)
RETURN b.branch_id as branch_id, b.name as name
`;

/**
 * Get checkpoint tree for visualization
 */
export const CYPHER_GET_CHECKPOINT_TREE = `
MATCH (t:Thread {thread_id: $thread_id, checkpoint_ns: $checkpoint_ns})
      -[:HAS_CHECKPOINT]->(c:Checkpoint)
OPTIONAL MATCH (c)-[:PREVIOUS]->(parent:Checkpoint)
OPTIONAL MATCH (c)-[:ON_BRANCH]->(b:Branch)
RETURN c.checkpoint_id as checkpoint_id,
       parent.checkpoint_id as parent_id,
       b.branch_id as branch_id,
       b.name as branch_name
ORDER BY c.checkpoint_id
`;

/**
 * Delete a branch (but not its checkpoints - they may be shared)
 */
export const CYPHER_DELETE_BRANCH = `
MATCH (b:Branch {branch_id: $branch_id})
DETACH DELETE b
`;
