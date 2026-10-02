import type {Database as SqlDatabase,SqlJsStatic,SqlValue} from 'sql.js';
export class BrowserSqlite{
  private native:SqlDatabase;
  private depth=0;
  constructor(private module:SqlJsStatic,data?:Uint8Array){this.native=new module.Database(data);}
  replace(data?:Uint8Array){if(this.depth)throw new Error('不能在事务中替换数据库');this.native.close();this.native=new this.module.Database(data);this.native.run('PRAGMA foreign_keys=ON');}
  prepare(sql:string){
    const query=(args:unknown[])=>{
      const statement=this.native.prepare(sql);
      try{statement.bind(args as SqlValue[]);const rows:Record<string,SqlValue>[]=[];while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}
    };
    return {all:(...args:unknown[])=>query(args),get:(...args:unknown[])=>query(args)[0],run:(...args:unknown[])=>{
      this.native.run(sql,args as SqlValue[]);const changes=this.native.getRowsModified();
      return {changes,lastInsertRowid:Number(this.native.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0]||0)};
    }};
  }
  pragma(sql:string,options?:{simple?:boolean}){const rows=this.prepare('PRAGMA '+sql).all();return options?.simple?Object.values(rows[0]||{})[0]:rows;}
  exec(sql:string){this.native.run(sql);return this;}
  transaction<T extends unknown[],R>(work:(...args:T)=>R){return (...args:T)=>{
    const name='nested_'+this.depth++,nested=this.depth>1;this.native.run(nested?'SAVEPOINT '+name:'BEGIN');
    try{const result=work(...args);if(result instanceof Promise)throw new Error('SQLite 事务不能包含异步操作');this.native.run(nested?'RELEASE '+name:'COMMIT');return result;}
    catch(error){this.native.run(nested?'ROLLBACK TO '+name:'ROLLBACK');if(nested)this.native.run('RELEASE '+name);throw error;}
    finally{this.depth--;}
  };}
  serialize(){if(this.depth)throw new Error('只能保存完整事务');const data=this.native.export();this.native.run('PRAGMA foreign_keys=ON');return data;}
  close(){this.native.close();}
}
export default class BrowserDatabaseUnavailable{constructor(){throw new Error('浏览器数据库必须异步初始化，不能使用电脑 SQLite 文件。');}}
