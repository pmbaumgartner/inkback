import manifest from "../../package.json" with { type: "json" };

export const AGENT_SETUP_URL =
  "https://raw.githubusercontent.com/pmbaumgartner/roughdraft/main/packages/app/public/setup.md";
export const FORK_INSTALL_COMMAND = `npm install -g https://github.com/pmbaumgartner/roughdraft/releases/download/v${manifest.version}/roughdraft-${manifest.version}.tgz`;
export const AGENT_SETUP_PROMPT = `Install Roughdraft for me using \`${FORK_INSTALL_COMMAND}\`, then read ${AGENT_SETUP_URL} and set yourself up to use it.`;
