export type Role='ADMIN'|'READER'; export type PublishStatus='DRAFT'|'PUBLISHED';
export interface UserDto{id:string;name:string;username:string;role:Role;active:boolean;createdAt:string}
export interface ChapterDto{id:string;bookId:string;title:string;content:string;sortOrder:number}
export interface BookDto{id:string;seriesId:string;title:string;subtitle:string|null;description:string;volumeNumber:number;sortOrder:number;status:PublishStatus;coverUrl:string|null;chapters?:ChapterDto[];bookmarked?:boolean}
export interface SeriesDto{id:string;title:string;description:string;genre:string;status:PublishStatus;sortOrder:number;coverUrl:string|null;books:BookDto[]}
export type JournalPermission='NONE'|'READ'|'COMMENT'|'WRITE';
export interface SeriesSummaryDto{id:string;title:string;description:string;genre:string;bookCount:number;coverUrl:string|null;kind:'series'}
export interface PublicJournalDto{id:string;title:string;description:string;ownerName:string;entryCount:number;kind:'journal'}
export interface JournalShareDto{userId:string;username:string;name:string;permission:JournalPermission}
export interface JournalCommentDto{id:string;entryId:string;authorId:string;authorName:string;content:string;createdAt:string;updatedAt:string;canEdit:boolean;canDelete:boolean}
export interface JournalEntryDto{id:string;journalId:string;title:string|null;content:string;entryDate:string;published:boolean;createdAt:string;updatedAt:string;permission:JournalPermission|'OWNER';shares?:JournalShareDto[];comments?:JournalCommentDto[]}
export interface JournalDto{id:string;ownerId:string;ownerName:string;title:string;description:string;createdAt:string;updatedAt:string;permission:JournalPermission|'OWNER';entries:JournalEntryDto[];shares?:JournalShareDto[]}
