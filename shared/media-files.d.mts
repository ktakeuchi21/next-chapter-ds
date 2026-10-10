export type MediaAsset={id:string;preview?:boolean;variant?:'edited'|'edited-preview';file:string;sourceKey:string;size?:number;mime:string};
export function mediaAssets(media: any[]): MediaAsset[];
