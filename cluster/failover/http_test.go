package failover

import (
 "bytes"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
)

func TestPlanHTTP(t *testing.T) {
 c:=sample()
 b,err:=json.Marshal(c);if err!=nil {t.Fatal(err)}
 r:=httptest.NewRequest(http.MethodPost,"/v1/cluster/failover/plan",bytes.NewReader(b))
 w:=httptest.NewRecorder();NewPlanHandler().ServeHTTP(w,r)
 if w.Code!=http.StatusOK || !strings.Contains(w.Body.String(),"vm1") {t.Fatalf("%d %s",w.Code,w.Body.String())}
}
func TestPlanHTTPUnsafe(t *testing.T) {
 c:=sample();c.Quorum=false
 b,_:=json.Marshal(c)
 w:=httptest.NewRecorder()
 NewPlanHandler().ServeHTTP(w,httptest.NewRequest(http.MethodPost,"/v1/cluster/failover/plan",bytes.NewReader(b)))
 if w.Code!=http.StatusConflict {t.Fatalf("status %d",w.Code)}
}
func TestPlanHTTPRejectsUnknownFields(t *testing.T) {
 w:=httptest.NewRecorder()
 NewPlanHandler().ServeHTTP(w,httptest.NewRequest(http.MethodPost,"/v1/cluster/failover/plan",strings.NewReader(`{"Quorum":true,"unexpected":true}`)))
 if w.Code!=http.StatusBadRequest {t.Fatalf("status %d",w.Code)}
}
func TestPlanHTTPRejectsOversize(t *testing.T) {
 w:=httptest.NewRecorder()
 NewPlanHandler().ServeHTTP(w,httptest.NewRequest(http.MethodPost,"/v1/cluster/failover/plan",strings.NewReader(strings.Repeat(" ",1<<20+1))))
 if w.Code!=http.StatusBadRequest {t.Fatalf("status %d",w.Code)}
}
