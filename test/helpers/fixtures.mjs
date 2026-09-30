// Shared synthetic transcript fixtures. Tests write only under .test-output/ in the project root.
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../../.test-output/', import.meta.url));
await mkdir(root, {recursive:true});

export const row = (role, rest={}) => ({type:'message', message:{role, timestamp:1000, ...rest}});
export const user = row('user', {content:[{type:'text', text:'PRIVATE PROMPT'}]});
export const call = (name, id='call', args={}) => row('assistant', {
  stopReason:'toolUse', content:[{type:'toolCall', id, name, arguments:args}],
});
export const result = id => row('toolResult', {toolCallId:id, content:[{type:'text', text:'SECRET OUTPUT'}]});
export const final = row('assistant', {stopReason:'stop', content:[{type:'text', text:'PRIVATE ANSWER'}]});
export const line = r => JSON.stringify(r) + '\n';
