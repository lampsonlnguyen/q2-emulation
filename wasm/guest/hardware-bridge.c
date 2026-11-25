/* Experimental binary transport, separate from Linux console.
 * Host -> guest: device byte (1..4), LE16 length, packed MIPS input_event bytes.
 * Guest -> host: 'Q2F1', blank byte, 480000 raw BGRA bytes.
 * Run inside the writable firmware chroot with an inherited dedicated serial fd.
 */
#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/mman.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <signal.h>
#define FRAME (320*375*4)
#define MAX_CLIENTS 32
static int listeners[4], clients[4][MAX_CLIENTS];

static int full(int fd, void *buf, size_t n, int writing) {
    unsigned char *p = buf;
    while (n) {
        ssize_t k = writing ? write(fd,p,n) : read(fd,p,n);
        if (k < 0 && errno == EINTR) continue;
        if (k <= 0) return -1;
        p += k; n -= (size_t)k;
    }
    return 0;
}
static unsigned flag(const char *path) {
    unsigned n=0;
    FILE *f=fopen(path,"r");
    if(f){ if(fscanf(f,"%x",&n)!=1)n=0; fclose(f); }
    return n;
}
static int server(int i) {
    struct sockaddr_un a={.sun_family=AF_UNIX};
    snprintf(a.sun_path,sizeof(a.sun_path),"/tmp/q2emu/event%d.sock",i+1);
    unlink(a.sun_path);
    int fd=socket(AF_UNIX,SOCK_STREAM|SOCK_NONBLOCK,0);
    if(fd<0 || bind(fd,(void*)&a,sizeof(a)) || listen(fd,16)) return -1;
    return fd;
}
static void accept_clients(void) {
    for(int d=0;d<4;d++) {
        for(;;) {
            int fd=accept4(listeners[d],NULL,NULL,SOCK_NONBLOCK);
            if(fd<0)break;
            int i=0;
            while(i<MAX_CLIENTS && clients[d][i]>=0)i++;
            if(i==MAX_CLIENTS)close(fd); else clients[d][i]=fd;
        }
    }
}
static void broadcast(int d,const unsigned char *p,size_t n) {
    for(int i=0;i<MAX_CLIENTS;i++) {
        int fd=clients[d][i];
        if(fd>=0 && send(fd,p,n,MSG_NOSIGNAL)!=(ssize_t)n) {
            close(fd); clients[d][i]=-1;
        }
    }
}
int main(int argc,char **argv) {
    if(argc!=2)return 2;
    int shared=strcmp(argv[1],"shared")==0;
    int fd=shared?-1:atoi(argv[1]);
    signal(SIGPIPE,SIG_IGN);
    mkdir("/tmp/q2emu",0755);
    for(int d=0;d<4;d++) {
        listeners[d]=server(d);
        if(listeners[d]<0){perror("input socket");return 1;}
        for(int i=0;i<MAX_CLIENTS;i++)clients[d][i]=-1;
    }
    int fb=open("/dev/fb0",O_RDONLY);
    if(fb<0){perror("framebuffer");return 1;}
    unsigned char *map=mmap(NULL,2*FRAME,PROT_READ,MAP_SHARED,fb,0);
    if(map==MAP_FAILED){perror("mmap");return 1;}
    unsigned char *previous=malloc(FRAME), *snapshot=malloc(FRAME);
    if(!previous||!snapshot)return 1;
    int first=1, lastblank=-1;
    for(;;) {
        accept_clients();
        struct pollfd p={fd,POLLIN,0};
        int result=poll(&p,1,shared?30:100);
        if(shared) {
            int input=open("/tmp/q2bridge/input",O_RDONLY);
            if(input>=0) {
                unsigned char h[3], data[1024];
                if(!full(input,h,3,0)) {
                    unsigned n=h[1]|(h[2]<<8);
                    if(h[0]>=1&&h[0]<=4&&n&&n<=sizeof(data)&&n%16==0&&!full(input,data,n,0)) broadcast(h[0]-1,data,n);
                }
                close(input); unlink("/tmp/q2bridge/input");
            }
        }
        if(result<0 && errno!=EINTR)return 1;
        if(result>0 && (p.revents&POLLIN)) {
            unsigned char h[3], data[1024];
            if(full(fd,h,3,0))return 1;
            unsigned n=h[1]|(h[2]<<8);
            if(h[0]<1||h[0]>4||!n||n>sizeof(data)||n%16)return 1;
            if(full(fd,data,n,0))return 1;
            broadcast(h[0]-1,data,n);
        }
        if(p.revents&(POLLERR|POLLHUP|POLLNVAL))return 1;
        unsigned page=flag("/tmp/q2emu/fb.pan")/375;
        if(page>1)page=0;
        int blank=!!flag("/tmp/q2emu/fb.blank");
        memcpy(snapshot,map+page*FRAME,FRAME);
        if(first||blank!=lastblank||memcmp(previous,snapshot,FRAME)) {
            unsigned char h[5]={'Q','2','F','1',(unsigned char)blank};
            if(shared) {
                int output=open("/tmp/q2bridge/frame.tmp",O_WRONLY|O_CREAT|O_TRUNC,0644);
                if(output<0){perror("frame open");return 1;}
                int failed=full(output,h,sizeof(h),1)||full(output,snapshot,FRAME,1);
                close(output);
                if(failed||rename("/tmp/q2bridge/frame.tmp","/tmp/q2bridge/frame")){perror("frame publish");return 1;}
            } else if(full(fd,h,sizeof(h),1)||full(fd,snapshot,FRAME,1))return 1;
            memcpy(previous,snapshot,FRAME);
            first=0;lastblank=blank;
        }
    }
}
