import { ToolRegistry } from '../registry';
import { getClientCapabilities, getClientState } from '../../client/self_model';

const ACTIONS = [
  'open_app',
  'close_app',
  'set_mode',
  'set_client_mode',
  'focus_home',
  'open_music_center',
  'show_music_layer',
  'hide_music_layer',
  'start_meeting_mode',
  'end_meeting_mode',
  'open_meeting_notes',
  'open_canvas_task',
  'show_knowledge_base',
  'open_organization_workspace',
  'open_files',
  'open_settings',
  'open_computer_adaptation',
  'open_skills',
  'open_tools',
  'open_team',
  'open_chat',
  'set_wallpaper_mode',
];

export function registerClientSelfTools(registry: ToolRegistry): void {
  registry.register({
    name: 'client_get_state',
    description: 'Read Lumi desktop client self-model: available client capabilities and the latest reported UI state.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async (_args, context) => {
      return JSON.stringify({
        capabilities: getClientCapabilities(),
        state: getClientState(context?.userId || 'anonymous'),
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'client_action',
    description: [
      'Safely control Lumi client UI surfaces through the client action router.',
      'Use explicit client-native actions like open_music_center, start_meeting_mode, open_canvas_task, show_knowledge_base, open_computer_adaptation, open_settings, or set_wallpaper_mode.',
      'Legacy open_app/close_app/set_mode are still accepted for compatibility.',
      'This does not use mouse/keyboard control and should be preferred over computer_use for Lumi client UI navigation.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'Client action to perform.',
        },
        target: {
          type: 'string',
          description: 'Target app/surface for open_app or close_app, e.g. org, knowledge, canvas, files, skills, team, music-center, settings.',
        },
        mode: {
          type: 'string',
          enum: ['chat', 'meeting', 'music', 'assistant', 'autonomous'],
          description: 'Target Lumi mode for set_mode or set_client_mode.',
        },
        task: {
          type: 'string',
          description: 'Optional task text for open_canvas_task.',
        },
        enabled: {
          type: 'boolean',
          description: 'Desired boolean state, currently used by set_wallpaper_mode.',
        },
        section: {
          type: 'string',
          description: 'Optional settings section for open_settings.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Set true only when the user explicitly confirmed a confirmation-sensitive action.',
        },
      },
      required: ['action'],
    },
    handler: async (args, context) => {
      if (!context?.desktopRelay) {
        throw new Error('Client actions require the Lumi desktop client relay.');
      }
      return context.desktopRelay('client_action', {
        action: args.action,
        target: args.target || '',
        mode: args.mode || '',
        task: args.task || '',
        enabled: Boolean(args.enabled),
        section: args.section || '',
        confirmed: Boolean(args.confirmed),
      });
    },
    permission: 'user',
    securityLevel: 'safe',
  });
}
