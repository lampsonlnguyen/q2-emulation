/* Browser guest WPA control plane, modeled on emulator/wifi.py.
 * Association is simulated, but no IP address or internet access is claimed.
 * The browser network data plane is a separate, future component. */
#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <poll.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#define SOCKET "/var/run/wpa_supplicant/wlan0"
#define SSID "Emulator Wi-Fi"
#define BSSID "02:51:32:00:00:01"
#define MAX_NET 16
#define MAX_MON 16
struct net { int used, disabled; char ssid[128], key_mgmt[32]; };
struct monitor { struct sockaddr_un addr; socklen_t size; };
static struct net nets[MAX_NET];
static struct monitor monitors[MAX_MON];
static int current=-1;
static int bind_socket(void) {
    struct sockaddr_un addr={.sun_family=AF_UNIX};
    snprintf(addr.sun_path,sizeof(addr.sun_path),"%s",SOCKET);
    mkdir("/var/run/wpa_supplicant",0755);
    unlink(SOCKET);
    int fd=socket(AF_UNIX,SOCK_DGRAM|SOCK_CLOEXEC,0);
    if(fd<0)return -1;
    if(bind(fd,(struct sockaddr*)&addr,sizeof(addr))<0){close(fd);return -1;}
    return fd;
}
static void event(int fd,const char *msg) {
    for(int i=0;i<MAX_MON;i++) if(monitors[i].size)
        if(sendto(fd,msg,strlen(msg),MSG_DONTWAIT|MSG_NOSIGNAL,
                  (struct sockaddr*)&monitors[i].addr,monitors[i].size)<0)
            monitors[i].size=0;
}
static void monitor(int attach,const struct sockaddr_un *peer,socklen_t size) {
    int free_slot=-1;
    for(int i=0;i<MAX_MON;i++){
        if(monitors[i].size==size&&!memcmp(&monitors[i].addr,peer,size)){
            if(!attach)monitors[i].size=0;
            return;
        }
        if(!monitors[i].size&&free_slot<0)free_slot=i;
    }
    if(attach&&free_slot>=0){monitors[free_slot].addr=*peer;monitors[free_slot].size=size;}
}
static int id_of(const char *s) {
    char *end; long id=strtol(s,&end,10);
    return end!=s&&(*end==0||*end==' ')&&id>=0&&id<MAX_NET&&nets[id].used?(int)id:-1;
}
static int ours(int id) {
    return id>=0&&nets[id].used&&(!strcmp(nets[id].ssid,"\"" SSID "\"")||
           !strcmp(nets[id].ssid,"456d756c61746f722057692d4669"))&&
           (!nets[id].key_mgmt[0]||!strcmp(nets[id].key_mgmt,"NONE"));
}
int main(void) {
    int fd=-1;
    for(;;){
        if(fd<0){fd=bind_socket();if(fd<0){sleep(1);continue;}}
        struct pollfd p={.fd=fd,.events=POLLIN};
        int ready=poll(&p,1,500);
        if(ready<0&&errno==EINTR)continue;
        if(ready<=0){
            if(ready<0||access(SOCKET,F_OK)!=0){close(fd);fd=-1;memset(monitors,0,sizeof(monitors));}
            continue;
        }
        char cmd[4096],reply_buf[4096],event_buf[256];
        struct sockaddr_un peer={0};socklen_t size=sizeof(peer);
        ssize_t n=recvfrom(fd,cmd,sizeof(cmd)-1,0,(struct sockaddr*)&peer,&size);
        if(n<=0||size>sizeof(peer))continue;
        cmd[n]=0;char *newline=strpbrk(cmd,"\r\n");if(newline)*newline=0;
        char *arg=strchr(cmd,' ');if(arg)*arg++=0;else arg=cmd+strlen(cmd);
        const char *reply="FAIL\n",*notice=NULL;
        int id=id_of(arg);
        if(!strcmp(cmd,"PING"))reply="PONG\n";
        else if(!strcmp(cmd,"ATTACH")||!strcmp(cmd,"DETACH")){monitor(!strcmp(cmd,"ATTACH"),&peer,size);reply="OK\n";}
        else if(!strcmp(cmd,"STATUS")||!strcmp(cmd,"STATUS-VERBOSE")){
            if(current<0)reply="wpa_state=INACTIVE\naddress=02:51:32:00:00:02\n";
            else {snprintf(reply_buf,sizeof(reply_buf),"bssid=" BSSID "\nfreq=2437\nssid=" SSID "\nid=%d\nmode=station\nkey_mgmt=NONE\nwpa_state=COMPLETED\naddress=02:51:32:00:00:02\n",current);reply=reply_buf;}
        }else if(!strcmp(cmd,"SCAN")){reply="OK\n";notice="<3>CTRL-EVENT-SCAN-RESULTS ";}
        else if(!strcmp(cmd,"SCAN_RESULTS"))reply="bssid / frequency / signal level / flags / ssid\n" BSSID "\t2437\t-42\t[ESS]\t" SSID "\n";
        else if(!strcmp(cmd,"BSS")&&(!strcmp(arg,"0")||!strcmp(arg,"FIRST")||!strcmp(arg,BSSID)))reply="bssid=" BSSID "\nfreq=2437\nlevel=-42\nflags=[ESS]\nssid=" SSID "\n";
        else if(!strcmp(cmd,"SIGNAL_POLL")&&current>=0)reply="RSSI=-42\nLINKSPEED=72\nNOISE=9999\nFREQUENCY=2437\n";
        else if(!strcmp(cmd,"LIST_NETWORKS")){
            size_t off=(size_t)snprintf(reply_buf,sizeof(reply_buf),"network id / ssid / bssid / flags\n");
            for(int i=0;i<MAX_NET;i++)if(nets[i].used&&off<sizeof(reply_buf)){
                int k=snprintf(reply_buf+off,sizeof(reply_buf)-off,"%d\t%s\tany\t%s\n",i,nets[i].ssid,i==current?"[CURRENT]":nets[i].disabled?"[DISABLED]":"");
                if(k<0||(size_t)k>=sizeof(reply_buf)-off)break;
                off+=(size_t)k;
            }reply=reply_buf;
        }else if(!strcmp(cmd,"ADD_NETWORK")){
            for(int i=0;i<MAX_NET;i++)if(!nets[i].used){nets[i]=(struct net){.used=1,.disabled=1};snprintf(reply_buf,sizeof(reply_buf),"%d\n",i);reply=reply_buf;break;}
        }else if((!strcmp(cmd,"SET_NETWORK")||!strcmp(cmd,"GET_NETWORK"))&&id>=0){
            char *key=strchr(arg,' ');
            if(key){key++;char *val=strchr(key,' ');if(val)*val++=0;
                char *dst=NULL;size_t cap=0;
                if(!strcmp(key,"ssid")){dst=nets[id].ssid;cap=sizeof(nets[id].ssid);}
                else if(!strcmp(key,"key_mgmt")){dst=nets[id].key_mgmt;cap=sizeof(nets[id].key_mgmt);}
                if(dst){
                    if(!strcmp(cmd,"SET_NETWORK")&&val&&strlen(val)<cap){memcpy(dst,val,strlen(val)+1);reply="OK\n";}
                    else if(!strcmp(cmd,"GET_NETWORK")){snprintf(reply_buf,sizeof(reply_buf),"%s\n",dst);reply=reply_buf;}
                }
            }
        }else if(!strcmp(cmd,"SELECT_NETWORK")||!strcmp(cmd,"ENABLE_NETWORK")||!strcmp(cmd,"RECONNECT")||!strcmp(cmd,"REASSOCIATE")){
            if(id<0&&(!strcmp(arg,"all")||!*arg))for(int i=0;i<MAX_NET;i++)if(ours(i)){id=i;break;}
            if(ours(id)){current=id;nets[id].disabled=0;reply="OK\n";snprintf(event_buf,sizeof(event_buf),"<3>CTRL-EVENT-CONNECTED - Connection to " BSSID " completed [id=%d id_str=]",id);notice=event_buf;}
        }else if(!strcmp(cmd,"DISCONNECT")||!strcmp(cmd,"TERMINATE")||!strcmp(cmd,"DISABLE_NETWORK")||!strcmp(cmd,"REMOVE_NETWORK")){
            if(!strcmp(cmd,"DISABLE_NETWORK")||!strcmp(cmd,"REMOVE_NETWORK")){
                for(int i=0;i<MAX_NET;i++)if(i==id||!strcmp(arg,"all")){
                    nets[i].disabled=1;if(!strcmp(cmd,"REMOVE_NETWORK"))nets[i].used=0;
                }
            }
            if(current>=0&&(!strcmp(cmd,"DISCONNECT")||!strcmp(cmd,"TERMINATE")||current==id||!strcmp(arg,"all"))){current=-1;notice="<3>CTRL-EVENT-DISCONNECTED bssid=" BSSID " reason=3 locally_generated=1";}
            reply="OK\n";
        }else if(!strcmp(cmd,"INTERFACES")||!strcmp(cmd,"IFNAME"))reply="wlan0\n";
        else if(!strcmp(cmd,"SET")||!strcmp(cmd,"AP_SCAN")||!strcmp(cmd,"SCAN_INTERVAL"))reply="OK\n";
        /* SAVE_CONFIG is deliberately unsupported until persistence exists. */
        (void)sendto(fd,reply,strlen(reply),MSG_DONTWAIT|MSG_NOSIGNAL,(struct sockaddr*)&peer,size);
        if(notice)event(fd,notice);
    }
}
