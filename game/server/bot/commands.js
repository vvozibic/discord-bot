const STRING = 3;
const SUBCOMMAND = 1;

function stringOption(name, description, { required = false, maxLength = 4000, minLength = 1 } = {}) {
  return { type:STRING, name, description, required, min_length:minLength, max_length:maxLength };
}

const messageOption = (description = 'ID of a support card created by this bot') => stringOption('message', description, { required:true, minLength:15, maxLength:22 });
const textOption = () => stringOption('text', 'Support card text', { required:true });
const titleOption = () => stringOption('title', 'Support card title (defaults to Support on creation)', { maxLength:256 });
const imageOption = () => stringOption('image', 'Optional HTTPS image URL', { maxLength:2048 });

/** Slash commands only. Keep Discord's separate Activity entry point intact. */
export function botCommands() {
  const command = (name, description, extra = {}) => ({
    type:1, name, description, dm_permission:false, contexts:[0], integration_types:[0], ...extra,
  });
  const subcommand = (name, description, options = []) => ({ type:SUBCOMMAND, name, description, ...(options.length ? { options } : {}) });

  return [
    command('play', 'Launch the Forest Trail Activity'),
    command('participate', 'Join this server\'s Forest Trail campaign'),
    command('trail-ranking', 'View this server\'s Forest Trail leaderboard'),
    command('trail-profile', 'View your Forest Trail campaign participation and results'),
    command('support', 'Open the server support channel'),
    command('bot-setup', 'Manage Forest Trail and support channel panels', {
      default_member_permissions:'32',
      options:[
        subcommand('game-panel', 'Post the Forest Trail participation panel'),
        subcommand('support-card', 'Create a support card before the authentic Ticket Tool panel', [textOption(), titleOption(), imageOption()]),
        subcommand('support-update', 'Edit a support card created by this bot', [messageOption(), textOption(), titleOption(), imageOption()]),
        subcommand('support-hide', 'Hide the authentic Ticket Tool panel embed and keep its ticket button', [messageOption('ID of the authentic Ticket Tool panel message')]),
        subcommand('support-restore', 'Restore the authentic Ticket Tool panel embed', [messageOption('ID of the authentic Ticket Tool panel message')]),
      ],
    }),
  ];
}
