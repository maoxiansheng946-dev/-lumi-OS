import { ToolRegistry } from '../registry';

async function mouseMove(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) throw new Error('Mouse control requires the Tauri desktop app');
  return context.desktopRelay('desktop_mouse_move', { x: args.x, y: args.y });
}

async function mouseClick(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) throw new Error('Mouse control requires the Tauri desktop app');
  return context.desktopRelay('desktop_mouse_click', { button: args.button || 'left' });
}

async function mouseDrag(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) throw new Error('Mouse control requires the Tauri desktop app');
  return context.desktopRelay('desktop_mouse_drag', {
    from_x: args.from_x,
    from_y: args.from_y,
    to_x: args.to_x,
    to_y: args.to_y,
    button: args.button || 'left',
  });
}

async function keyType(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) throw new Error('Keyboard control requires the Tauri desktop app');
  return context.desktopRelay('desktop_keyboard_type', { text: args.text });
}

async function keyPress(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) throw new Error('Keyboard control requires the Tauri desktop app');
  return context.desktopRelay('desktop_keyboard_press', { key: args.key });
}

export function registerInputTools(registry: ToolRegistry): void {
  registry.register({
    name: 'mouse_move',
    description:
      'Move the mouse cursor to absolute screen coordinates (x, y). Use this to position the cursor before clicking or to hover over UI elements. Coordinates are pixels from the top-left corner of the primary monitor.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal pixel coordinate from the left edge of the primary monitor.' },
        y: { type: 'number', description: 'Vertical pixel coordinate from the top edge of the primary monitor.' },
      },
      required: ['x', 'y'],
    },
    handler: mouseMove,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'mouse_click',
    description:
      'Click a mouse button at the current cursor position. Use after mouse_move to interact with buttons, links, or any UI element.',
    parameters: {
      type: 'object',
      properties: {
        button: { type: 'string', description: 'Mouse button: "left", "right", or "middle". Defaults to "left".' },
      },
      required: [],
    },
    handler: mouseClick,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'mouse_drag',
    description:
      'Click and drag from one screen position to another. Useful for moving windows, selecting text, or drag-and-drop operations.',
    parameters: {
      type: 'object',
      properties: {
        from_x: { type: 'number', description: 'Starting x coordinate.' },
        from_y: { type: 'number', description: 'Starting y coordinate.' },
        to_x: { type: 'number', description: 'Ending x coordinate.' },
        to_y: { type: 'number', description: 'Ending y coordinate.' },
        button: { type: 'string', description: 'Mouse button: "left", "right", or "middle". Defaults to "left".' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
    handler: mouseDrag,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'keyboard_type',
    description:
      'Type a text string at the current keyboard focus. Use to fill in text fields, compose messages, or input content.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to type.' },
      },
      required: ['text'],
    },
    handler: keyType,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'keyboard_press',
    description:
      'Press a keyboard key or key combination. For single keys use names like "enter", "escape", "tab", "space", "backspace", "delete", "home", "end", "pageup", "pagedown", "up", "down", "left", "right", "f1".."f12", or a single character. For combos use "ctrl+c", "ctrl+shift+t", "alt+tab", "ctrl+v" etc. Supported modifiers: ctrl, shift, alt, meta (Windows key / Cmd).',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name or combination. E.g., "enter", "ctrl+c", "alt+tab", "ctrl+shift+t".' },
      },
      required: ['key'],
    },
    handler: keyPress,
    permission: 'user',
    securityLevel: 'safe',
  });
}
