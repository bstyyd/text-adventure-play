import type {makeService} from './service';
import type {LocalSecurity} from '../security/local';
import type {Bootstrap} from '../domain/offline';
export type RequestScope={security:LocalSecurity;service?:ReturnType<typeof makeService>;deployment?:Bootstrap['deployment'];dataDir?:string};
