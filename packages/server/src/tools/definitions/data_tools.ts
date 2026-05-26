import { ToolRegistry } from '../registry';
import { readDB } from '../../data/db_layer';

async function databaseQueryHandler(args: Record<string, any>): Promise<string> {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('SQL query is required.');

  const upperQuery = query.toUpperCase();
  const isReadOnly = upperQuery.startsWith('SELECT') || upperQuery.startsWith('PRAGMA');
  if (!isReadOnly) {
    throw new Error('Only SELECT and PRAGMA queries are allowed for security reasons.');
  }

  // JSON-file database — simple table name extraction for SELECT
  try {
    const db = readDB();
    // Extract table name from "SELECT ... FROM <table>"
    const match = query.match(/from\s+(\w+)/i);
    const table = match ? match[1].toLowerCase() : null;

    let data: any[] = [];
    if (table && (db as any)[table]) {
      data = (db as any)[table];
    } else if (table) {
      return JSON.stringify({ error: `Table '${table}' not found`, tables: Object.keys(db) });
    } else {
      return JSON.stringify({ error: 'Could not determine table name', tables: Object.keys(db) });
    }

    const maxRows = Math.min(Math.max(Number(args.maxRows) || 50, 1), 200);
    const limited = data.slice(0, maxRows);
    return JSON.stringify(limited, null, 2);
  } catch (err: any) {
    return `Query error: ${err.message}`;
  }
}

export function registerDataOpsTools(registry: ToolRegistry): void {
  registry.register({
    name: 'database_query',
    description: 'Run a read-only SQL query (SELECT or PRAGMA only) against the local LumiAI database.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query (SELECT or PRAGMA only)' },
        maxRows: { type: 'number', description: 'Maximum rows to return (default 50, max 200)' },
      },
      required: ['query'],
    },
    handler: databaseQueryHandler,
    permission: 'admin',
    securityLevel: 'confirm',
  });
}
