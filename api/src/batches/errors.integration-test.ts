import { prisma } from "@ecomkit/database";
import { BatchesService } from "./batches.service.js";
const service=new BatchesService(); let a:string,b:string;
const ok=(v:unknown,m:string)=>{if(!v)throw new Error(m)};
async function main(){
 const ba=await prisma.batch.create({data:{createdByUserId:"STAGE8_TEST"}}), bb=await prisma.batch.create({data:{createdByUserId:"STAGE8_TEST"}});a=ba.id;b=bb.id;
 const f1=await prisma.uploadedFile.create({data:{batchId:a,originalFilename:"stage8-a.pdf",sanitizedFilename:"stage8-a.pdf",fileType:"PDF",storagePath:"/app/storage/secret.pdf"}});
 const f2=await prisma.uploadedFile.create({data:{batchId:a,originalFilename:"stage8-b.xlsx",sanitizedFilename:"stage8-b.xlsx",fileType:"EXCEL"}});
 const data=Array.from({length:25},(_,i)=>({batchId:a,uploadedFileId:i%2?f1.id:f2.id,errorCode:i===0?"PDF_READ_ERROR":"EXCEL_EMPTY_ORDER_CODE",message:`issue ${i}`,severity:i<3?"ERROR" as const:"WARNING" as const,rawValue:i===0?"<script>alert(1)</script>":null,rawContext:i===0?{path:"/app/storage/private",text:"<script>alert(1)</script>"}:undefined}));
 await prisma.processingError.createMany({data}); const foreign=await prisma.processingError.create({data:{batchId:b,errorCode:"PDF_READ_ERROR",message:"foreign",severity:"ERROR"}});
 const list=await service.findErrors(a,{});ok(list.summary.totalErrors===25&&list.summary.errorCount===3&&list.summary.warningCount===22&&list.items.length===20,"summary/page");
 ok((await service.findErrors(a,{page:2,pageSize:20})).items.length===5,"page2"); ok((await service.findErrors(a,{severity:"ERROR"})).pagination.total===3,"severity");ok((await service.findErrors(a,{errorCode:"PDF_READ_ERROR"})).pagination.total===1,"code");ok((await service.findErrors(a,{uploadedFileId:f1.id})).items.every(x=>x.uploadedFile?.id===f1.id),"file");
 await service.findErrors(a,{page:0}).then(()=>{throw Error("invalid page")}).catch(e=>ok(e?.status===400,"invalid page")); await service.findErrors(a,{pageSize:99999}).then(()=>{throw Error("invalid pageSize")}).catch(e=>ok(e?.status===400,"invalid pageSize"));
 const detail=await service.findError(a,list.items.find(x=>x.errorCode==="PDF_READ_ERROR")!.id);ok(JSON.stringify(detail).includes("[redacted]")&&!JSON.stringify(detail).includes("/app/storage"),"redaction");await service.findError(b,detail.id).then(()=>{throw Error("cross batch")}).catch(e=>ok(e?.status===404,"isolation"));await service.findError(a,"missing").then(()=>{throw Error("unknown")}).catch(e=>ok(e?.status===404,"unknown"));console.log(`Stage 8 errors integration passed; batchId=${a}`);
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{for(const id of process.env.STAGE8_KEEP_TEST_DATA ? [b] : [a,b])if(id)await prisma.batch.delete({where:{id}}).catch(()=>{});await prisma.$disconnect()});
