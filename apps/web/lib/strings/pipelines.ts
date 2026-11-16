// Copy for Settings → Pipelines (M1-T3b).

export const pipelineStrings = {
  title: 'Pipelines',
  description:
    'The steps a lead goes through. Your business type set these up; rename, reorder or add your own.',
  empty: 'No pipelines yet.',
  newPipeline: 'New pipeline',
  newPipelineTitle: 'New pipeline',
  newPipelineHint: 'It starts with stages New, In progress, Won and Lost — change them after.',
  editPipelineTitle: (name: string) => `Edit “${name}”`,
  default: 'Default',
  defaultHint: 'New leads go here unless a form or source says otherwise.',
  makeDefault: 'Make default',
  rename: 'Edit',
  delete: 'Delete',
  moveUp: (name: string) => `Move ${name} up`,
  moveDown: (name: string) => `Move ${name} down`,
  fields: {
    name: 'Name',
    lostReasons: 'Lost reasons (one per line)',
    lostReasonsHint: 'Offered when a lead is marked lost. Agents can still type their own.',
    stageName: 'Stage name',
    category: 'Category',
    probability: 'Win probability (%)',
  },
  categories: { open: 'Open', won: 'Won', lost: 'Lost' },
  categoryHints: {
    open: 'Lead is still being worked',
    won: 'Deal done (records the win date)',
    lost: 'Lead dropped (asks for a reason)',
  },
  columns: { stage: 'Stage', category: 'Category', probability: 'Probability', actions: 'Actions' },
  addStage: 'Add stage',
  addStageTitle: (pipeline: string) => `Add a stage to ${pipeline}`,
  editStageTitle: (name: string) => `Edit stage “${name}”`,
  save: 'Save',
  create: 'Create pipeline',
  created: (name: string) => `Pipeline “${name}” created`,
  saved: 'Saved',
  defaultSet: (name: string) => `“${name}” is now the default pipeline`,
  deleted: (name: string) => `“${name}” deleted`,
  deletePipelineTitle: (name: string) => `Delete pipeline “${name}”?`,
  deletePipelineBody:
    'It disappears from lists and forms. Pipelines that still have leads can’t be deleted.',
  deleteStageTitle: (name: string) => `Delete stage “${name}”?`,
  deleteStageBody: 'Leads can’t be left without a stage.',
  stageHasLeads: (n: number) =>
    `${n} ${n === 1 ? 'lead is' : 'leads are'} in this stage. Choose where to move ${n === 1 ? 'it' : 'them'}.`,
  noTarget: (category: string) =>
    `There is no other ${category.toLowerCase()} stage to move these leads to. Add one first, then delete this stage.`,
  moveTo: 'Move leads to',
  moveAndDelete: 'Move leads and delete',
  stageDeleted: (name: string, moved: number) =>
    moved > 0 ? `Stage “${name}” deleted, ${moved} leads moved` : `Stage “${name}” deleted`,
} as const;
