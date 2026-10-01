import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Platform, prisma } from "@ecomkit/database";
import type { LazadaTransport, LazadaTransportRequest } from "@ecomkit/marketplace-server";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { LazadaAdminService } from "./lazada-admin.service.js";

const oldKey=process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY;
process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY=randomBytes(32).toString("base64");
const APP_SECRET="TEST_LAZADA_APP_SECRET",TOKEN="TEST_LAZADA_ACCESS_TOKEN";
class FakeTransport implements LazadaTransport{requests:LazadaTransportRequest[]=[];async send(request:LazadaTransportRequest){this.requests.push(request);return{status:200,body:JSON.stringify({code:"0",request_id:"req-safe",data:{count:0,countTotal:0,orders:[]}})}}}
const user=await prisma.user.findFirst({select:{id:true}});if(!user)throw new Error("test user required");
const crypto=new MarketplaceCredentialService(),transport=new FakeTransport(),service=new LazadaAdminService(crypto,()=>transport);
try{
 await prisma.marketplaceConnection.deleteMany({where:{platform:Platform.LAZADA}});await prisma.marketplaceProviderConfig.deleteMany({where:{platform:Platform.LAZADA}});
 const saved=await service.updateConfig(user.id,{appKey:"TEST_APP_KEY",appSecret:APP_SECRET,enabled:true});assert.equal(saved.appSecretConfigured,true);assert.ok(!JSON.stringify(saved).includes(APP_SECRET));
 let config=await prisma.marketplaceProviderConfig.findUniqueOrThrow({where:{platform:Platform.LAZADA}});const firstEnvelope=config.partnerSecretEnvelope;assert.ok(!firstEnvelope.includes(APP_SECRET));
 await service.updateConfig(user.id,{appKey:"TEST_APP_KEY_2",enabled:true});config=await prisma.marketplaceProviderConfig.findUniqueOrThrow({where:{platform:Platform.LAZADA}});assert.equal(config.partnerSecretEnvelope,firstEnvelope);
 const connection=await service.saveExternal(user.id,{sellerId:"seller-42",accessToken:TOKEN,accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString()});assert.equal(connection.refreshOwnership,"EXTERNAL");
 const row=await prisma.marketplaceConnection.findUniqueOrThrow({where:{id:connection.id}});assert.ok(!row.credentialEnvelope!.includes(TOKEN));const plain=crypto.decryptCredential(row.credentialEnvelope!);assert.equal(plain.accessToken,TOKEN);assert.equal(plain.refreshToken,undefined);assert.equal(plain.providerMetadata?.refreshOwnership,"EXTERNAL");
 const overview=await service.overview();assert.equal(overview.config?.appKey,"TEST_APP_KEY_2");assert.equal(overview.connections[0]?.accessTokenConfigured,true);assert.ok(!JSON.stringify(overview).includes(TOKEN));assert.ok(!JSON.stringify(overview).includes(APP_SECRET));
 const structural=await service.structuralTest(connection.id);assert.equal(structural.liveProviderTested,false);assert.equal(transport.requests.length,0);
 const live=await service.liveTest(connection.id);assert.equal(live.success,true);assert.equal(transport.requests.length,1);const requestUrl=new URL(transport.requests[0]!.url);assert.equal(requestUrl.pathname,"/rest/orders/get");assert.equal(requestUrl.searchParams.get("limit"),"1");assert.ok(!JSON.stringify(live).includes(TOKEN));
 await service.saveExternal(user.id,{sellerId:"seller-42",accessTokenExpiresAt:new Date(Date.now()+7200000).toISOString()});assert.equal(crypto.decryptCredential((await prisma.marketplaceConnection.findUniqueOrThrow({where:{id:connection.id}})).credentialEnvelope!).accessToken,TOKEN);
 const expiredEnvelope=crypto.encryptCredential({...plain,tokenExpiresAt:new Date(Date.now()-1000).toISOString()});await prisma.marketplaceConnection.update({where:{id:connection.id},data:{credentialEnvelope:expiredEnvelope}});const callsBefore=transport.requests.length;await assert.rejects(service.liveTest(connection.id),(e:unknown)=>JSON.stringify(e).includes("EXTERNAL_ACCESS_TOKEN_EXPIRED"));assert.equal(transport.requests.length,callsBefore);
 console.log("Lazada admin configuration integration tests passed");
}finally{await prisma.marketplaceConnection.deleteMany({where:{platform:Platform.LAZADA}});await prisma.marketplaceProviderConfig.deleteMany({where:{platform:Platform.LAZADA}});if(oldKey===undefined)delete process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY;else process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY=oldKey;await prisma.$disconnect()}
