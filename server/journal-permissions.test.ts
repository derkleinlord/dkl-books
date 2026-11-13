import {describe,expect,it} from 'vitest';
import {resolveJournalPermission} from './app.js';

describe('resolveJournalPermission',()=>{
  it('gives the owner full control',()=>{
    expect(resolveJournalPermission(true,'NONE','NONE')).toBe('OWNER');
  });
  it('uses the journal permission by default',()=>{
    expect(resolveJournalPermission(false,'WRITE')).toBe('WRITE');
  });
  it('lets an entry permission override and revoke journal access',()=>{
    expect(resolveJournalPermission(false,'WRITE','READ')).toBe('READ');
    expect(resolveJournalPermission(false,'WRITE','NONE')).toBe('NONE');
  });
  it('denies access without a share',()=>{
    expect(resolveJournalPermission(false)).toBe('NONE');
  });
});
