import {describe,expect,it} from 'vitest';
import {filterLibrary} from './app.js';

const library=[
  {
    title:'Die Chroniken',
    books:[
      {title:'Der Anfang',volumeNumber:1},
      {title:'Abschied',volumeNumber:7},
    ],
  },
  {title:'Andere Reihe',books:[{title:'Ein Abschied auf Zeit',volumeNumber:2}]},
];

describe('Bibliothekssuche',()=>{
  it('filtert einzelne Bücher nach Titel',()=>{
    expect(filterLibrary(library,'Abschied').map(series=>series.books)).toEqual([
      [{title:'Abschied',volumeNumber:7}],
      [{title:'Ein Abschied auf Zeit',volumeNumber:2}],
    ]);
  });

  it('behält alle Bücher bei einem Treffer im Reihennamen',()=>{
    expect(filterLibrary(library,'Chroniken')[0].books).toHaveLength(2);
  });

  it.each(['Band VII','Band 7','VII','7'])('filtert %s nach Bandnummer',query=>{
    expect(filterLibrary(library,query)).toEqual([
      {title:'Die Chroniken',books:[{title:'Abschied',volumeNumber:7}]},
    ]);
  });

  it('liefert bei null Treffern eine leere Liste',()=>{
    expect(filterLibrary(library,'Nicht vorhanden')).toEqual([]);
  });
});
