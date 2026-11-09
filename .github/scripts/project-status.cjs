module.exports = async ({ github, core }) => {
  const projectId = 'PVT_kwDOAMredc4Bc1Rw';
  const result = await github.graphql(`query($id: ID!) {
    node(id: $id) { ... on ProjectV2 {
      field(name: "Status") { ... on ProjectV2SingleSelectField {
        id options { id name }
      } }
    } }
  }`, { id: projectId });
  const field = result.node.field;
  const options = Object.fromEntries(field.options.map(option => [option.name, option.id]));
  for (const name of ['Incoming', 'Quantum foam', 'DONE', 'History']) {
    if (!options[name]) throw new Error(`Missing status: ${name}`);
  }
  const items = [];
  let after = null;
  do {
    const page = await github.graphql(`query($id: ID!, $after: String) {
      node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      } } }
    }`, { id: projectId, after });
    items.push(...page.node.items.nodes);
    after = page.node.items.pageInfo.hasNextPage ? page.node.items.pageInfo.endCursor : null;
  } while (after);
  let foam = 0;
  let history = 0;
  for (const item of items) {
    // Read immediately before writing so earlier manual staging is respected.
    const current = await github.graphql(`query($id: ID!) {
      node(id: $id) { ... on ProjectV2Item {
        fieldValueByName(name: "Status") {
          ... on ProjectV2ItemFieldSingleSelectValue { name }
        }
        content {
          ... on Issue { closed }
          ... on PullRequest { closed merged }
        }
      } }
    }`, { id: item.id });
    const value = current.node;
    if (!value) continue;
    const status = value.fieldValueByName?.name;
    let destination;
    if (status === 'Incoming' && (value.content?.closed || value.content?.merged)) {
      destination = 'Quantum foam';
    } else if (process.env.ARCHIVE_DONE === 'true' && status === 'DONE') {
      destination = 'History';
    } else {
      continue;
    }
    await github.graphql(`mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project itemId: $item fieldId: $field
        value: { singleSelectOptionId: $option }
      }) { projectV2Item { id } }
    }`, { project: projectId, item: item.id, field: field.id, option: options[destination] });
    if (destination === 'Quantum foam') foam++;
    else history++;
  }
  await core.summary.addHeading('Project status maintenance')
    .addRaw(`Moved ${foam} completed Incoming items to Quantum foam.\n\n`)
    .addRaw(`Moved ${history} DONE items to History.\n`).write();
};
