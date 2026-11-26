/* Offline WPA control-plane stand-in, based on emulator/wifi.py.
 * Real network connectivity is intentionally not advertised until a browser
 * network transport exists. Runs inside the firmware chroot. */
#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <poll.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>

#define SOCKET "/var/run/wpa_supplicant/wlan0"
static int bind_socket(void) {
    struct sockaddr_un addr = {.sun_family=AF_UNIX};
    snprintf(addr.sun_path,sizeof(addr.sun_path),"%s",SOCKET);
    mkdir("/var/run/wpa_supplicant",0755);
    unlink(SOCKET);
    int fd=socket(AF_UNIX,SOCK_DGRAM|SOCK_CLOEXEC,0);
    if(fd<0)return -1;
    if(bind(fd,(struct sockaddr*)&addr,sizeof(addr))<0){close(fd);return -1;}
    return fd;
}
int main(void) {
    int fd=-1;
    for(;;) {
        if(fd<0){fd=bind_socket();if(fd<0){sleep(1);continue;}}
        struct pollfd p={.fd=fd,.events=POLLIN};
        int ready=poll(&p,1,500);
        if(ready<0&&errno==EINTR)continue;
        if(ready<=0){
            if(ready<0||access(SOCKET,F_OK)!=0){close(fd);fd=-1;}
            continue;
        }
        char cmd[4096];
        struct sockaddr_un peer={0};
        socklen_t size=sizeof(peer);
        ssize_t n=recvfrom(fd,cmd,sizeof(cmd)-1,0,(struct sockaddr*)&peer,&size);
        if(n<=0)continue;
        cmd[n]=0;
        char *newline=strpbrk(cmd,"\r\n");if(newline)*newline=0;
        const char *reply="FAIL\n";
        if(!strcmp(cmd,"PING"))reply="PONG\n";
        else if(!strcmp(cmd,"STATUS")||!strcmp(cmd,"STATUS-VERBOSE"))
            reply="wpa_state=INACTIVE\naddress=02:51:32:00:00:02\n";
        else if(!strcmp(cmd,"SCAN_RESULTS"))
            reply="bssid / frequency / signal level / flags / ssid\n";
        else if(!strcmp(cmd,"LIST_NETWORKS"))
            reply="network id / ssid / bssid / flags\n";
        else if(!strcmp(cmd,"INTERFACES")||!strcmp(cmd,"IFNAME"))reply="wlan0\n";
        else if(!strcmp(cmd,"ATTACH")||!strcmp(cmd,"DETACH")||
                !strcmp(cmd,"DISCONNECT")||!strcmp(cmd,"TERMINATE")||
                !strcmp(cmd,"SCAN")||!strncmp(cmd,"SET ",4)||
                !strncmp(cmd,"AP_SCAN ",8))reply="OK\n";
        (void)sendto(fd,reply,strlen(reply),MSG_NOSIGNAL,(struct sockaddr*)&peer,size);
        if(!strcmp(cmd,"SCAN")){
            const char *event="<3>CTRL-EVENT-SCAN-RESULTS ";
            /* The scan caller may not be a monitor, so don't inject unsolicited
             * replies into its command socket. Monitor support comes with AP mode. */
            (void)event;
        }
    }
}
