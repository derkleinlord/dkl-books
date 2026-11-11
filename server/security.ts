import sanitizeHtml from 'sanitize-html';
export const cleanRichText=(html:string)=>sanitizeHtml(html,{allowedTags:['p','br','h2','h3','strong','em','ul','ol','li','blockquote'],allowedAttributes:{}});
export const publicUser=<T extends {passwordHash?:string}>(user:T)=>{const {passwordHash:_,...safe}=user;return safe};
