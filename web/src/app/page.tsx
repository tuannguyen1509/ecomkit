"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { useCurrentUser } from "../components/auth-shell";
import { Alert,Card,EmptyState,PageHeader,SectionHeader,Skeleton,StatCard,StatusBadge } from "../components/ui/ui";
import { apiFetch } from "../lib/api";
import styles from "./home.module.css";

type Batch={id:string;createdAt:string;processingStatus:"PENDING"|"PROCESSING"|"SUCCESS"|"WARNING"|"ERROR";fileCount:number;orderCount:number;warningCount:number;errorCount:number};
type History={pagination:{total:number};items:Batch[]};
type Marketplace={config:{partnerSecretConfigured:boolean;enabled:boolean}|null;encryptionReady:boolean;connections:Array<{id:string;status:string}>};
const statusLabels:Record<Batch["processingStatus"],string>={PENDING:"Chờ xử lý",PROCESSING:"Đang xử lý",SUCCESS:"Hoàn tất",WARNING:"Có cảnh báo",ERROR:"Có lỗi"};

export default function HomePage(){
 const user=useCurrentUser(),isAdmin=user?.role==="ADMIN";
 const[history,setHistory]=useState<History|null>(null),[marketplace,setMarketplace]=useState<Marketplace|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false);
 const load=useCallback(async()=>{setLoading(true);setError(false);try{const historyResponse=await apiFetch("/batches/history?page=1&pageSize=5");if(!historyResponse.ok)throw new Error("history");setHistory(await historyResponse.json() as History);if(isAdmin){const marketplaceResponse=await apiFetch("/admin/marketplaces/providers/shopee");if(marketplaceResponse.ok)setMarketplace(await marketplaceResponse.json() as Marketplace)}}catch{setError(true)}finally{setLoading(false)}},[isAdmin]);
 useEffect(()=>{if(user)void Promise.resolve().then(load)},[user,load]);
 const recent=history?.items??[],recentOrders=recent.reduce((sum,item)=>sum+item.orderCount,0),attention=recent.filter(item=>item.processingStatus==="ERROR"||item.processingStatus==="WARNING").length,activeConnections=marketplace?.connections.filter(item=>item.status==="ACTIVE").length??0;
 return <main className={styles.page}>
  <PageHeader eyebrow="Ecomkit · Vui Khỏe" title={`Chào ${user?.displayName||user?.username||"bạn"}`} description="Theo dõi hoạt động xử lý đơn hàng và các kết nối sàn thương mại điện tử tại một nơi." actions={<><Link className={styles.primaryAction} href="/batches/new">Tạo phiên xử lý</Link><Link className={styles.secondaryAction} href="/history">Xem lịch sử</Link></>}/>
  {error&&<Alert tone="danger">Không thể tải dữ liệu tổng quan. <button onClick={()=>void load()}>Thử lại</button></Alert>}
  <section className={styles.stats} aria-label="Chỉ số tổng quan">{loading?<>{[1,2,3,4].map(item=><Card className={styles.statSkeleton} key={item}><Skeleton/><Skeleton/></Card>)}</>:<><StatCard label="Tổng Batch" value={history?.pagination.total??0} hint="Tất cả lịch sử" icon="B"/><StatCard label="Đơn trong 5 Batch gần nhất" value={recentOrders} hint="Không phải tổng toàn hệ thống" icon="Đ"/><StatCard label="Cần chú ý" value={attention} hint="Cảnh báo hoặc lỗi gần đây" icon="!"/>{isAdmin&&<StatCard label="Kết nối Marketplace" value={activeConnections} hint="Đang hoạt động" icon="M"/>}</>}</section>
  <div className={styles.columns}><Card className={styles.activity}><SectionHeader title="Hoạt động gần đây" description="5 Batch mới nhất" action={<Link href="/history">Xem tất cả</Link>}/>{loading?<div className={styles.loadingRows}>{[1,2,3].map(item=><Skeleton key={item}/>)}</div>:recent.length===0?<EmptyState title="Chưa có lịch sử xử lý" description="Tạo phiên xử lý đầu tiên để bắt đầu." action={<Link className={styles.primaryAction} href="/batches/new">Tạo phiên xử lý</Link>}/>:<div className={styles.activityList}>{recent.map(item=><Link href={`/batches/${item.id}/results`} className={styles.activityRow} key={item.id}><span className={styles.batchIcon}>B</span><div><strong>Batch {item.id.slice(0,8)}</strong><small>{new Date(item.createdAt).toLocaleString("vi-VN")} · {item.orderCount} đơn · {item.fileCount} file</small></div><StatusBadge status={item.processingStatus} label={statusLabels[item.processingStatus]}/></Link>)}</div>}</Card>
   <aside className={styles.sideColumn}><Card className={styles.quick}><SectionHeader title="Thao tác nhanh"/><Link href="/batches/new"><span>＋</span><div><strong>Tạo phiên xử lý</strong><small>Tải Excel/PDF và xử lý đơn</small></div></Link>{isAdmin&&<Link href="/marketplaces"><span>⌁</span><div><strong>Marketplace</strong><small>Quản lý cấu hình và kết nối</small></div></Link>}<Link href="/history"><span>↻</span><div><strong>Lịch sử</strong><small>Xem kết quả và cảnh báo</small></div></Link></Card>{isAdmin&&<Card className={styles.marketplaces}><SectionHeader title="Marketplace" action={<Link href="/marketplaces">Quản lý</Link>}/>{loading?<Skeleton/>:<><MarketplaceRow name="Shopee" status={marketplace?.connections.some(item=>item.status==="ACTIVE")?"ACTIVE":marketplace?.config?.partnerSecretConfigured?"PENDING":"NOT_CONFIGURED"}/><MarketplaceRow name="Lazada" status="NOT_CONFIGURED" note="Chưa triển khai"/><MarketplaceRow name="TikTok Shop" status="NOT_CONFIGURED" note="Chưa triển khai"/></>}</Card>}</aside>
  </div>
 </main>
}
function MarketplaceRow({name,status,note}:{name:string;status:string;note?:string}){const label=note??(status==="ACTIVE"?"Đang hoạt động":status==="PENDING"?"Đã cấu hình":"Chưa cấu hình");return <div className={styles.marketplaceRow}><div><span className={styles.marketplaceLogo}>{name.slice(0,1)}</span><strong>{name}</strong></div><StatusBadge status={status} label={label}/></div>}
