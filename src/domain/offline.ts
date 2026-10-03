import type {ScenarioSummary} from '../scenario/schema';
import type { Capabilities, NpcId, Profile, Save, Turn, TurnInput, View } from './types';
import type { CharacterBook } from '../characters/schema';
export type Bootstrap={scenarios:ScenarioSummary[];saves:Save[];npcs:{id:NpcId;name:string;role:string;age:number|null;description:string}[];dataDir:string;profiles:(Profile&{hasKey:boolean;keyRemembered?:boolean;rememberKeyPreference?:boolean;endpoint:string;capabilities:Capabilities})[];selected:{narrator:string;extractor:string};style:string;lastError:string;backupError:string;keyStorageWarning?:string;accessMode:'local'|'lan'|'public';deployment?:{playerMode:'isolated';providerMode:'site';loginRequired:boolean;usedRequests:number;playerDailyRequests:number;maxOutputTokens:number}};
export type OfflineCopy={
  formatVersion:1;serverId:string;revision:string;downloadedAt:string;saveId:string;title:string;
  scope:{branches:number;turns:number;from:string;to:string};
  views:Record<string,View>;books:Record<string,CharacterBook>;
  // Only explicit full downloads include the recoverable (and private) archive.
  // Reading surfaces always use views/books projected by the server instead.
  archive:unknown;bootstrap:Bootstrap;
};
export type ReadingPlace={turnId?:string;offset:number;scrollTop:number;page:number};
export type LocalDraft={text:string;target:NpcId|null;ooc:boolean};
export type PendingRequest=TurnInput&{revisionBody?:string};
export type StoryPage={turns:Turn[];total:number;page:number;pageSize:number};
