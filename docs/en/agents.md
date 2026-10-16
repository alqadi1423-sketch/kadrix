# AI agents and MCP

Veloq has a built-in [Model Context Protocol](https://modelcontextprotocol.io)
server, so AI coding tools such as Claude Code, Cursor or VS Code can find
issues, update them, comment and log time, all inside the permissions you
give them.

## Add an agent

1. An admin opens **Settings → Agents** and adds an agent, for example
   "Claude Code". Leave "Can create and change issues" on unless it should only read.
2. Copy the token shown. It appears once.
3. Connect your tool with one of the commands shown there.

Claude Code:

```bash
claude mcp add --transport http veloq https://veloq.example.com/api/mcp \
  --header "Authorization: Bearer vlq_..."
```

Other clients (JSON):

```json
{ "mcpServers": { "veloq": { "type": "http", "url": "https://veloq.example.com/api/mcp",
  "headers": { "Authorization": "Bearer vlq_..." } } } }
```

## What agents can do

| Tool | Does |
|---|---|
| `list_projects`, `list_states`, `list_members` | Look up projects, workflow states and people |
| `search_issues` | Find issues by text (Arabic or English), project, status or assignee |
| `get_issue` | An issue with its description, sub-issues, relations and comments |
| `create_issue`, `update_issue` | Create or change issues (write access only) |
| `add_comment`, `log_time` | Comment or record time (write access only) |
| `search_docs` | Search workspace docs |

Every tool goes through the same API and permission checks as a person with
the same token, and everything shows up in history under the agent's name.
Read-only agents do not see the write tools at all.

## Personal tokens

People can also create their own tokens in **Settings → API tokens** and use
them with the MCP server or the [REST API](api.md). Those act as that person.

## Removing an agent

**Remove** revokes its token and membership at once. Its past work stays in
history under its name.
