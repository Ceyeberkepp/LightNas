package failover

import (
 "encoding/json"
 "io"
 "net/http"
)

// NewPlanHandler exposes an intentionally read-only planning endpoint.
// Production deployments must place this behind authenticated, authorized
// cluster management APIs. Never expose this handler publicly on its own.
func NewPlanHandler() http.Handler {
 mux:=http.NewServeMux()
 mux.HandleFunc("POST /v1/cluster/failover/plan",func(w http.ResponseWriter,r *http.Request){
  r.Body=http.MaxBytesReader(w,r.Body,1<<20)
  defer r.Body.Close()
  dec:=json.NewDecoder(r.Body)
  dec.DisallowUnknownFields()
  var c Cluster
  if err:=dec.Decode(&c);err!=nil {
   http.Error(w,"invalid cluster snapshot",http.StatusBadRequest);return
  }
  var extra any
  if err:=dec.Decode(&extra);err!=io.EOF {
   http.Error(w,"unexpected trailing data",http.StatusBadRequest);return
  }
  p,err:=PlanRecovery(c)
  if err!=nil {
   http.Error(w,"unsafe cluster state: quorum and fencing required",http.StatusConflict);return
  }
  w.Header().Set("Content-Type","application/json")
  w.Header().Set("Cache-Control","no-store")
  _=json.NewEncoder(w).Encode(p)
 })
 return mux
}
