export type Role='ADMIN'|'READER'; export type PublishStatus='DRAFT'|'PUBLISHED';
export interface UserDto{id:string;name:string;username:string;role:Role;active:boolean;createdAt:string}
export interface ChapterDto{id:string;bookId:string;title:string;content:string;sortOrder:number;status:PublishStatus}
export interface BookDto{id:string;seriesId:string;title:string;subtitle:string|null;description:string;volumeNumber:number;sortOrder:number;status:PublishStatus;coverUrl:string|null;chapters?:ChapterDto[];bookmarked?:boolean}
export interface SeriesDto{id:string;title:string;description:string;genre:string;status:PublishStatus;sortOrder:number;books:BookDto[]}
