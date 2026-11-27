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
    int first=1, lastblank=-1, partial_mode=0;
    /* Negotiate once at startup; avoid a failed 9p lookup on every poll. */
    if(shared) partial_mode=access("/tmp/q2bridge/partial-frames",F_OK)==0;
    for(;;) {
        accept_clients();
        struct pollfd p={fd,POLLIN,0};
        /* Avoid repeatedly scanning the 480 KB framebuffer and issuing
         * synchronous 9p lookups while the firmware is idle. */
        int result=poll(&p,1,shared?80:100);
        if(shared) {
            int input=open("/tmp/q2bridge/input",O_RDONLY);
            if(input>=0) {
                /* Read the bounded batch locally instead of making two 9p
                 * read requests for every individual input report. */
                unsigned char batch[32*(3+1024)];
                size_t used=0;
                while(used<sizeof(batch)) {
                    ssize_t n=read(input,batch+used,sizeof(batch)-used);
                    if(n<0 && errno==EINTR) continue;
                    if(n<=0) break;
                    used+=(size_t)n;
                }
                size_t pos=0;
                for(unsigned report=0;report<32 && used-pos>=3;report++) {
                    unsigned device=batch[pos], n=batch[pos+1]|(batch[pos+2]<<8);
                    pos+=3;
                    if(device<1||device>4||!n||n>1024||n%16||n>used-pos) break;
                    broadcast(device-1,batch+pos,n);
                    pos+=n;
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
        /* Never replace an unacknowledged delta: the browser must consume
         * every published baseline before the next delta is computed. */
        if(partial_mode && access("/tmp/q2bridge/frame",F_OK)==0) continue;
        unsigned page=flag("/tmp/q2emu/fb.pan")/375;
        if(page>1)page=0;
        int blank=!!flag("/tmp/q2emu/fb.blank");
        if(first||blank!=lastblank||memcmp(previous,map+page*FRAME,FRAME)) {
            memcpy(snapshot,map+page*FRAME,FRAME);
            unsigned char h[5]={'Q','2','F','1',(unsigned char)blank};
            if(shared) {
                int output=open("/tmp/q2bridge/frame.tmp",O_WRONLY|O_CREAT|O_TRUNC,0644);
                if(output<0){int e=errno;fprintf(stderr,"frame open errno=%d: %s\n",e,strerror(e));return 1;}
                unsigned start=0,end=375;
                if(partial_mode && !first && blank==lastblank) {
                    while(start<375 && !memcmp(previous+start*1280,snapshot+start*1280,1280)) start++;
                    while(end>start && !memcmp(previous+(end-1)*1280,snapshot+(end-1)*1280,1280)) end--;
                }
                unsigned rows=end-start;
                int failed;
                if(partial_mode && rows>0 && rows<375) {
                    unsigned char delta[9]={'Q','2','F','2',(unsigned char)blank,(unsigned char)start,(unsigned char)(start>>8),(unsigned char)rows,(unsigned char)(rows>>8)};
                    failed=full(output,delta,sizeof(delta),1)||full(output,snapshot+start*1280,rows*1280,1);
                } else failed=full(output,h,sizeof(h),1)||full(output,snapshot,FRAME,1);
                close(output);
                if(failed||rename("/tmp/q2bridge/frame.tmp","/tmp/q2bridge/frame")){perror("frame publish");return 1;}
            } else if(full(fd,h,sizeof(h),1)||full(fd,snapshot,FRAME,1))return 1;
            memcpy(previous,snapshot,FRAME);
            first=0;lastblank=blank;
        }
    }
}
