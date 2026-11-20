import heapq
# Graphe non orienté : (u, v, coût, péage?)
E = [('S','A',4,False),('S','B',2,True),('A','B',1,False),('A','C',5,True),('B','C',8,False),
     ('B','D',10,False),('C','D',2,False),('C','E',3,True),('D','E',4,False),('D','T',11,False),
     ('E','T',3,False),('A','E',12,False)]
adj={}
for u,v,c,t in E:
  adj.setdefault(u,[]).append((v,c,t)); adj.setdefault(v,[]).append((u,c,t))
def best(maxtoll):
  pq=[(0,'S',0,('S',))]; seen={}
  while pq:
    d,u,k,path=heapq.heappop(pq)
    if u=='T': return d,path
    if seen.get((u,k),1e9)<=d: continue
    seen[(u,k)]=d
    for v,c,t in adj[u]:
      nk=k+t
      if nk<=maxtoll: heapq.heappush(pq,(d+c,v,nk,path+(v,)))
for m in (0,1,2): print('H5', m, best(m))
