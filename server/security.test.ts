import {describe,expect,it} from 'vitest';
import {cleanRichText,publicUser} from './security.js';
describe('security helpers',()=>{
  it('removes scripts, handlers and unsafe markup',()=>expect(cleanRichText('<p onclick="x()">Hallo <strong>Welt</strong></p><script>alert(1)</script><img src=x onerror=x>')).toBe('<p>Hallo <strong>Welt</strong></p>'));
  it('allows the documented rich text subset',()=>expect(cleanRichText('<h2>Titel</h2><blockquote><em>Zitat</em></blockquote><ul><li>A</li></ul>')).toContain('<blockquote>'));
  it('never exposes a password hash',()=>expect(publicUser({id:'1',passwordHash:'secret'})).toEqual({id:'1'}));
});
